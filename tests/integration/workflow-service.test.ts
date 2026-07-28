import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import { figmaStateFactsDigest } from "../../src/figma/figma-capture-contract.js";
import type { OpenSpecArchiveService } from "../../src/application/openspec-archive-service.js";
import { PublisherService } from "../../src/application/publisher-service.js";
import { RunService } from "../../src/application/run-service.js";
import { StageService } from "../../src/application/stage-service.js";
import {
  WorkflowPublishInputSchema,
  WorkflowService,
  type WorkflowServiceDependencies,
} from "../../src/application/workflow-service.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";
import type { RunStore } from "../../src/store/run-store.js";
import type {
  PublishedReviewRequest,
  PublishTarget,
  ReviewRequestPayload,
  ReviewRequestPublisher,
  ReviewRequestUpdate,
} from "../../src/publisher/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import { createDraftEvidenceBundle } from "../../src/workflow/draft-evidence-bundle.js";

const FIGMA_URL = "https://www.figma.com/design/abc/file?node-id=1-2";
const FIGMA_URL_SECOND_STATE = "https://www.figma.com/design/abc/file?node-id=3-4";
const FEATURE_CONTEXT_ID = `ctx_${"x".repeat(124)}`;
const execFileAsync = promisify(execFile);

describe("WorkflowService", () => {
  let directory: string;
  let store: SqliteRunStore;
  let artifactStore: ArtifactBlobStore;
  let service: WorkflowService;
  let dependencies: WorkflowServiceDependencies;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-workflow-"));
    for (const relativePath of [
      "generated/api.ts",
      "generated/schema.ts",
      "generated/wrapper.ts",
      "generated/mock.ts",
      "test-results/unit.json",
      "test-results/contract.json",
      "test-results/api-contract.json",
      "test-results/api-coverage.json",
      "test-results/performance.json",
      "visual/diff.png",
      "visual/actual.png",
      "visual/legacy.png",
      "contracts/requirements.json",
      "contracts/legacy-baseline.md",
      ".spec-to-pr/shop/manifest.json",
      "openspec/changes/migrate-shop-vue3/proposal.md",
      "openspec/changes/migrate-shop-vue3/specs/shop-migration/spec.md",
      "openspec/changes/migrate-shop-vue3/tasks.md",
      "docs/openapi.yaml",
      "figma/design-context.json",
      "mocks/manifest.json",
      "mocks/checkout.json",
      "test-results/checkout.json",
      "test-results/checkout.mp4",
      "briefs/checkout.md",
      "src/checkout.tsx",
      "src/parser.ts",
      "src/tracing.ts",
      ".gitignore",
    ]) {
      const absolutePath = path.join(directory, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, `${relativePath}\n`, "utf8");
    }
    await writeFile(
      path.join(directory, "briefs/checkout.md"),
      "Build a responsive checkout screen backed by the checkout API.\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, "docs/openapi.yaml"),
      "openapi: 3.1.0\npaths:\n  /checkout:\n    post:\n      operationId: checkout\n      responses: {}\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, "test-results/api-contract.json"),
      JSON.stringify({ status: "passed" }),
      "utf8",
    );
    await writeFile(
      path.join(directory, "test-results/api-coverage.json"),
      JSON.stringify({
        status: "passed",
        operationKeys: ["POST /checkout"],
        mockHandlers: ["generated/mock.ts#checkout"],
      }),
      "utf8",
    );
    await writeFile(
      path.join(directory, "test-results/performance.json"),
      JSON.stringify({
        status: "passed",
        metrics: { lcpMs: 2_100, cls: 0.04, tbtMs: 120 },
      }),
      "utf8",
    );
    const mockFixture = Buffer.from(JSON.stringify({ state: "checkout" }), "utf8");
    await writeFile(path.join(directory, "mocks/checkout.json"), mockFixture);
    await writeFile(
      path.join(directory, "mocks/manifest.json"),
      JSON.stringify({
        deterministic: true,
        fixtures: [
          {
            id: "mock:checkout",
            path: "mocks/checkout.json",
            sha256: `sha256:${createHash("sha256").update(mockFixture).digest("hex")}`,
            stateContractDigest: figmaStateContracts()[0]!.digest,
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(directory, "test-results/checkout.json"),
      JSON.stringify({
        status: "passed",
        selector: "e2e/checkout.spec.ts",
        implementationContextId: FEATURE_CONTEXT_ID,
        testCount: 1,
      }),
      "utf8",
    );
    await writeFile(path.join(directory, "test-results/checkout.mp4"), validMp4());
    await writeFile(
      path.join(directory, "figma/design-context.json"),
      JSON.stringify(figmaManifest()),
      "utf8",
    );
    await writeFile(
      path.join(directory, "visual/diff.png"),
      PNG.sync.write(new PNG({ width: 1, height: 1 })),
    );
    await writeFile(
      path.join(directory, "visual/actual.png"),
      PNG.sync.write(new PNG({ width: 1, height: 1 })),
    );
    await writeFile(
      path.join(directory, "visual/legacy.png"),
      PNG.sync.write(new PNG({ width: 1, height: 1 })),
    );
    await writeFile(
      path.join(directory, ".gitignore"),
      "artifacts/\nsources/\nruns.sqlite3*\nprofiles/\nvisual/actual/\n",
      "utf8",
    );
    await execFileAsync("git", ["init", "-q"], { cwd: directory });
    await execFileAsync("git", ["config", "user.email", "tests@example.com"], {
      cwd: directory,
    });
    await execFileAsync("git", ["config", "user.name", "Workflow Tests"], { cwd: directory });
    await execFileAsync("git", ["add", "."], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: directory });
    store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
    artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));

    dependencies = {
      runStore: store,
      artifactStore,
      runService: new RunService(store, { pluginVersion: "0.2.0" }),
      intakeRequestService: new IntakeRequestService(
        store,
        new SourceSnapshotStore(path.join(directory, "sources")),
        artifactStore,
      ),
      stageService: new StageService(store),
    };
    service = new WorkflowService(dependencies);
  });

  afterEach(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("defaults workflow publication to ready and accepts blocked diagnostics", () => {
    expect(
      WorkflowPublishInputSchema.parse({
        runId: `run_${"a".repeat(32)}`,
        mode: "preview",
        sourceBranch: "codex/diagnostic",
      }).intent,
    ).toBe("ready");
    expect(
      WorkflowPublishInputSchema.parse({
        runId: `run_${"a".repeat(32)}`,
        intent: "blocked-diagnostic",
        mode: "preview",
        sourceBranch: "codex/diagnostic",
      }),
    ).toMatchObject({ intent: "blocked-diagnostic", recoverUncertain: false });
    expect(
      WorkflowPublishInputSchema.parse({
        runId: `run_${"a".repeat(32)}`,
        intent: "blocked-diagnostic",
        mode: "execute",
        sourceBranch: "codex/diagnostic",
        confirm: true,
        recoverUncertain: true,
      }).recoverUncertain,
    ).toBe(true);
    for (const invalidRecovery of [
      { intent: "ready", mode: "execute", confirm: true },
      { intent: "blocked-diagnostic", mode: "preview", confirm: false },
      { intent: "blocked-diagnostic", mode: "execute", confirm: false },
    ] as const) {
      expect(
        WorkflowPublishInputSchema.safeParse({
          runId: `run_${"a".repeat(32)}`,
          sourceBranch: "codex/diagnostic",
          recoverUncertain: true,
          ...invalidRecovery,
        }).success,
      ).toBe(false);
    }
  });

  it("persists and exposes a strict workspace binding from a nested target", async () => {
    const workspace = await prepareStrictWorkspace(directory);

    const status = await service.start({
      projectRoot: path.join(directory, "src/pages/shop"),
      requestText: "Implement the supplied Figma shop states with deterministic mock data",
      scope: "ui",
      mode: "figma",
      publication: "draft",
      figmaUrl: FIGMA_URL,
      workspace: {
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        remoteName: "origin",
      },
    });

    expect(status.workspaceBinding).toMatchObject({
      repositoryRoot: await realpath(directory),
      targetPaths: ["src/pages/shop"],
      supportingPaths: [],
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      baseSha: workspace.releaseQaSha,
      initialHeadSha: workspace.releaseQaSha,
      remoteName: "origin",
      remoteProvider: "gitlab",
      remoteHost: "gitlab.com",
    });
    const run = await store.get(status.runId);
    expect(run.projectRoot).toBe(await realpath(directory));
    expect(run.baseCommit).toBe(workspace.releaseQaSha);
  });

  it("does not persist a Run when strict workspace validation fails", async () => {
    await prepareStrictWorkspace(directory);
    await writeFile(path.join(directory, "src/pages/shop/App.ts"), "export const shop = 2;\n");
    await execFileAsync("git", ["add", "."], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "unexpected implementation"], {
      cwd: directory,
    });

    await expect(
      service.start({
        projectRoot: path.join(directory, "src/pages/shop"),
        requestText: "Implement the supplied Figma shop states",
        scope: "ui",
        mode: "figma",
        publication: "draft",
        figmaUrl: FIGMA_URL,
        workspace: {
          sourceBranch: "codex/shop",
          targetBranch: "release-qa",
          remoteName: "origin",
        },
      }),
    ).rejects.toThrow(/WORKSPACE_TARGET_REF_MISMATCH/);
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("pins every supplied Figma state without enabling API scope from mock wording", async () => {
    const status = await service.start({
      projectRoot: directory,
      requestText:
        "Use the local MCP and deterministic mock API data to implement both Figma states",
      scope: "ui",
      mode: "figma",
      publication: "none",
      figmaUrls: [FIGMA_URL, FIGMA_URL_SECOND_STATE, FIGMA_URL],
    });

    expect(status.deliveryProfile.figmaUrls).toEqual([FIGMA_URL, FIGMA_URL_SECOND_STATE]);
    expect(status.deliveryProfile.figmaUrl).toBe(FIGMA_URL);
    expect(status.scope).toMatchObject({
      ui: true,
      api: false,
      hasVisualBaseline: true,
    });
    await expect(
      service.submit({
        runId: status.runId,
        submission: {
          kind: "figma-bundle",
          provider: "host-connected-figma",
          capturedAt: "2026-07-13T00:00:00.000Z",
          fileUrl: FIGMA_URL,
          fileUrls: [FIGMA_URL, FIGMA_URL_SECOND_STATE],
          nodeIds: ["1:2"],
          capturedComponents: figmaCapturedComponents(),
          designMapping: figmaDesignMapping(),
          manifestPath: "figma/design-context.json",
          stateContracts: figmaStateContracts(),
          visualTargets: figmaVisualTargets(),
          artifactPaths: ["figma/design-context.json", "visual/diff.png"],
        },
      }),
    ).rejects.toThrow(/every supplied URL state.*node-id=3-4/);
  });

  it("requires a passed report before ready publication planning", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser and publish the reviewed result",
      scope: "non-ui",
    });
    const plan = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { plan } as unknown as PublisherService,
    });

    await expect(
      service.publish({
        runId: started.runId,
        mode: "preview",
        sourceBranch: "codex/ready-report",
      }),
    ).rejects.toThrow(/passed report/i);
    expect(plan).not.toHaveBeenCalled();
  });

  it("requires the ready report to match the current review packet", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    await changeSource(directory, "src/parser.ts", "export const parser = 'stale-after-report';\n");
    const plan = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { plan } as unknown as PublisherService,
    });

    await expect(
      service.publish({
        runId,
        mode: "preview",
        sourceBranch: "codex/ready-report",
      }),
    ).rejects.toThrow(/review packet.*stale/i);
    expect(plan).not.toHaveBeenCalled();
  });

  it("rejects a passed ready report carrying an older review packet id", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    const run = await store.get(runId);
    await store.save(
      {
        ...run,
        revision: run.revision + 1,
        artifacts: run.artifacts.map((artifact) =>
          artifact.kind === "pr-report"
            ? { ...artifact, metadata: { ...artifact.metadata, reviewPacketId: "packet_stale" } }
            : artifact,
        ),
      },
      run.revision,
    );
    const plan = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { plan } as unknown as PublisherService,
    });

    await expect(
      service.publish({
        runId,
        mode: "preview",
        sourceBranch: "codex/ready-report",
      }),
    ).rejects.toThrow(/report.*current review packet/i);
    expect(plan).not.toHaveBeenCalled();
  });

  it("rejects a legacy pr-report-v2 JSON artifact at ready publication", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    const run = await store.get(runId);
    const jsonArtifact = run.artifacts.find(
      (artifact) => artifact.metadata["reportKind"] === "pr-report-v2-json",
    );
    if (jsonArtifact === undefined) throw new Error("Missing ready report JSON");
    const legacyReport = JSON.parse(
      (await artifactStore.readContent(jsonArtifact.digest)).toString("utf8"),
    ) as Record<string, unknown>;
    legacyReport["schemaVersion"] = "pr-report-v2";
    delete legacyReport["sectionStatuses"];
    const legacyBlob = await artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(legacyReport, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: run.updatedAt,
      label: "pr-report-v2.json",
    });
    await store.save(
      {
        ...run,
        revision: run.revision + 1,
        artifacts: run.artifacts.map((artifact) =>
          artifact.id === jsonArtifact.id
            ? { ...artifact, uri: legacyBlob.uri, digest: legacyBlob.digest }
            : artifact,
        ),
      },
      run.revision,
    );
    const plan = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { plan } as unknown as PublisherService,
    });

    await expect(
      service.publish({
        runId,
        mode: "preview",
        sourceBranch: "codex/legacy-report",
      }),
    ).rejects.toThrow(/current pr-report-v2\.1/i);
    expect(plan).not.toHaveBeenCalled();
  });

  it("previews blocked diagnostic publication without mutating durable state", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts that need an approval",
      scope: "non-ui",
      publication: "draft",
    });
    const blocked = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "Approval is missing.",
        blocker: {
          stage: "contracts",
          code: "MISSING_APPROVAL",
          kind: "missing-input",
          summary: "Approval is missing.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: [],
          attemptedRecovery: [],
          unrunValidations: ["functional"],
          exactUnblockAction: "Provide approval.",
        },
      },
    });
    const before = await store.get(started.runId);
    const plan = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { plan } as unknown as PublisherService,
    });

    const preview = await service.publish({
      runId: started.runId,
      intent: "blocked-diagnostic",
      mode: "preview",
      sourceBranch: "codex/blocked-diagnostic",
    });

    expect(preview).toEqual({
      runId: started.runId,
      intent: "blocked-diagnostic",
      mode: "preview",
      sourceBranch: "codex/blocked-diagnostic",
      targetBranch: "main",
      willEnsureReport: true,
      eligibleForPublication: true,
      preflightPending: true,
      skipped: false,
      blocker: {
        stage: "contracts",
        code: "MISSING_INPUT",
        kind: "missing-input",
        exactUnblockAction: blocked.blockerDetails[0]!.exactUnblockAction,
      },
    });
    expect(preview).not.toHaveProperty("willCreateOrUpdate");
    expect(plan).not.toHaveBeenCalled();
    expect(await store.get(started.runId)).toEqual(before);
  });

  it("stops and retries when the blocker changes while acquiring its diagnostic report", async () => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    const publish = vi.fn().mockResolvedValue({ sent: true });
    service = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
    });
    const ensureReport = service.ensureBlockedDiagnosticReport.bind(service);
    vi.spyOn(service, "ensureBlockedDiagnosticReport").mockImplementationOnce(async (rawInput) => {
      await service.submit({
        runId,
        submission: {
          kind: "contracts",
          status: "blocked",
          summary: "A newer approval is missing.",
          blocker: {
            stage: "contracts",
            code: "NEWER_MISSING_APPROVAL",
            kind: "missing-input",
            summary: "A newer approval is missing.",
            retryable: false,
            resumable: true,
            completedWork: [],
            evidencePaths: [],
            attemptedRecovery: [],
            unrunValidations: ["functional"],
            exactUnblockAction: "Provide the newer approval.",
          },
        },
      });
      return ensureReport(rawInput);
    });
    const input = {
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      sourceBranch: "codex/blocked-diagnostic",
      confirm: true,
    };

    const stopped = (await service.publish(input)) as Record<string, unknown>;

    expect(stopped).toMatchObject({
      intent: "blocked-diagnostic",
      skipped: true,
      reason: "diagnostic-context-changed",
      retryable: true,
      expectedReportKey: "contracts:0:MISSING_INPUT",
      actualReportKey: "contracts:1:MISSING_INPUT",
      diagnosticReport: {
        artifactId: expect.stringMatching(/^art_/),
        path: expect.stringMatching(/^artifact:\/\/sha256\//),
      },
      status: { status: "blocked" },
    });
    expect(stopped).not.toHaveProperty("result");
    expect(publish).not.toHaveBeenCalled();
    expect(
      (await store.get(runId)).artifacts.some(
        (artifact) => artifact.metadata["reportKind"] === "publish-result",
      ),
    ).toBe(false);

    await expect(service.publish(input)).resolves.toMatchObject({ result: { sent: true } });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent blocked diagnostic execution", async () => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    let releasePublish!: () => void;
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const publish = vi.fn().mockImplementation(async () => {
      await publishGate;
      const reportArtifactId = (await store.get(runId)).artifacts.find(
        (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
      )!.id;
      return {
        result: {
          runId,
          status: "blocked",
          requestSynced: true,
          request: {
            host: "github",
            url: "https://github.com/acme/spec-to-pr/pull/123",
            number: "123",
            draft: true,
            sourceBranch: "codex/blocked-diagnostic",
            targetBranch: "main",
            created: true,
            updated: false,
          },
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
    });
    service = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
    });
    const input = {
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      sourceBranch: "codex/blocked-diagnostic",
      confirm: true,
    };

    const first = service.publish(input);
    const second = service.publish(input);
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    releasePublish();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual(firstResult);
    expect(
      (await store.get(runId)).artifacts.filter(
        (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
      ),
    ).toHaveLength(1);
  });

  it("single-flights blocked diagnostics across WorkflowService instances sharing a RunStore", async () => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    let releasePublish!: () => void;
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const publish = vi.fn().mockImplementation(async () => {
      await publishGate;
      return { sent: true };
    });
    const claimDependencies = {
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
      externalLeaseTtlMs: 120,
      externalHeartbeatMs: 20,
    };
    const firstService = new WorkflowService(claimDependencies);
    const secondService = new WorkflowService(claimDependencies);
    const input = {
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      sourceBranch: "codex/blocked-diagnostic",
      confirm: true,
    };
    const stagesBefore = (await store.get(runId)).stages;

    const first = firstService.publish(input);
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const second = (await secondService.publish(input)) as Record<string, unknown>;

    expect(second).toMatchObject({
      intent: "blocked-diagnostic",
      skipped: true,
      reason: "diagnostic-publication-in-progress",
      retryable: true,
      status: { status: "blocked" },
    });
    expect(publish).toHaveBeenCalledTimes(1);
    releasePublish();
    await expect(first).resolves.toMatchObject({ result: { sent: true } });
    expect((await store.get(runId)).stages).toEqual(stagesBefore);
  });

  it("requires explicit recovery for a stale blocked-diagnostic publication claim", async () => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    const report = await service.ensureBlockedDiagnosticReport({ runId });
    const run = await store.get(runId);
    const staleTimestamp = run.updatedAt;
    const currentTimestamp = new Date(Date.parse(staleTimestamp) + 60_000).toISOString();
    const executionKey = createHash("sha256")
      .update(
        JSON.stringify({
          runId,
          reportKey: "contracts:0:MISSING_INPUT",
          sourceBranch: "codex/blocked-diagnostic",
          targetBranch: "main",
        }),
      )
      .digest("hex");
    const ownerClaimId = createArtifactId();
    const blob = await artifactStore.writeBlob({
      content: Buffer.from(
        `${JSON.stringify({ event: "claim", executionKey, ownerClaimId, expiresAt: staleTimestamp })}\n`,
        "utf8",
      ),
      mediaType: "application/json",
      storedAt: staleTimestamp,
      label: "diagnostic-publish-claim.json",
    });
    await store.save(
      {
        ...run,
        revision: run.revision + 1,
        updatedAt: currentTimestamp,
        artifacts: [
          ...run.artifacts,
          ArtifactRefSchema.parse({
            id: ownerClaimId,
            kind: "agent-result-report",
            uri: blob.uri,
            mediaType: "application/json",
            digest: blob.digest,
            producedBy: "orchestrator",
            evidenceIds: [],
            createdAt: staleTimestamp,
            metadata: {
              adapter: "workflow-v2",
              reportKind: "diagnostic-publish-claim",
              diagnosticExecutionKey: executionKey,
              claimState: "active",
              ownerClaimId,
              expiresAt: staleTimestamp,
            },
          }),
        ],
      },
      run.revision,
    );
    const publish = vi.fn().mockResolvedValue({ sent: true });
    const recoveryService = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
      now: () => currentTimestamp,
    });

    const uncertain = recoveryService.publish({
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      sourceBranch: "codex/blocked-diagnostic",
      remoteName: "upstream",
      pushBranch: false,
      confirm: true,
    });

    await expect(uncertain).resolves.toMatchObject({
      intent: "blocked-diagnostic",
      skipped: true,
      reason: "diagnostic-publication-uncertain",
      retryable: false,
      exactRecoveryInstruction: expect.stringContaining("recoverUncertain=true"),
    });
    expect(publish).not.toHaveBeenCalled();

    await expect(
      recoveryService.publish({
        runId,
        intent: "blocked-diagnostic" as const,
        mode: "execute" as const,
        sourceBranch: "codex/blocked-diagnostic",
        remoteName: "upstream",
        pushBranch: false,
        confirm: true,
        recoverUncertain: true,
      }),
    ).resolves.toMatchObject({ result: { sent: true } });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(report.metadata["idempotencyKey"]).toBe("contracts:0:MISSING_INPUT");
  });

  it("aborts and fences a live diagnostic owner after heartbeat persistence fails", async () => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    let initialClaimWritten = false;
    const heartbeatFailingStore: RunStore = {
      create: (run) => store.create(run),
      get: (id) => store.get(id),
      list: (filter) => store.list(filter),
      close: async () => {},
      save: async (run, expectedRevision) => {
        const current = await store.get(run.id);
        const newActiveClaim = run.artifacts
          .slice(current.artifacts.length)
          .some(
            (artifact) =>
              artifact.metadata["reportKind"] === "diagnostic-publish-claim" &&
              artifact.metadata["claimState"] === "active",
          );
        if (newActiveClaim && initialClaimWritten) {
          throw new Error("simulated diagnostic heartbeat persistence failure");
        }
        await store.save(run, expectedRevision);
        if (newActiveClaim) initialClaimWritten = true;
      },
    };
    let providerSignal: AbortSignal | undefined;
    const publish = vi
      .fn()
      .mockImplementationOnce(
        async (_input: unknown, options?: { signal?: AbortSignal }): Promise<unknown> => {
          providerSignal = options?.signal;
          if (providerSignal === undefined) return { missingSignal: true };
          return new Promise(() => undefined);
        },
      )
      .mockResolvedValueOnce({ sent: true });
    const firstService = new WorkflowService({
      ...dependencies,
      runStore: heartbeatFailingStore,
      publisherService: { publish } as unknown as PublisherService,
      externalLeaseTtlMs: 80,
      externalHeartbeatMs: 20,
    });
    const secondService = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
      externalLeaseTtlMs: 80,
      externalHeartbeatMs: 20,
    });
    const input = {
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      sourceBranch: "codex/blocked-diagnostic",
      confirm: true,
    };

    await expect(firstService.publish(input)).resolves.toMatchObject({
      skipped: true,
      reason: "diagnostic-publication-uncertain",
      retryable: false,
    });
    expect(providerSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const aliasRetry = { ...input, remoteName: "upstream", pushBranch: false };
    await expect(secondService.publish(aliasRetry)).resolves.toMatchObject({
      skipped: true,
      reason: "diagnostic-publication-uncertain",
    });
    expect(publish).toHaveBeenCalledTimes(1);

    await expect(
      secondService.publish({ ...aliasRetry, recoverUncertain: true }),
    ).resolves.toMatchObject({ result: { sent: true } });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not share concurrent diagnostic results across different publication identities", async () => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    let releasePublish!: () => void;
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const publish = vi.fn().mockImplementation(async (input: { sourceBranch: string }) => {
      await publishGate;
      const reportArtifactId = (await store.get(runId)).artifacts.find(
        (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
      )!.id;
      return {
        result: {
          runId,
          status: "blocked",
          requestSynced: true,
          request: {
            host: "github",
            url: `https://github.com/acme/spec-to-pr/pull/${input.sourceBranch.endsWith("one") ? "1" : "2"}`,
            number: input.sourceBranch.endsWith("one") ? "1" : "2",
            draft: true,
            sourceBranch: input.sourceBranch,
            targetBranch: "main",
            created: true,
            updated: false,
          },
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
    });
    service = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
    });
    const baseInput = {
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      targetBranch: "main",
      remoteName: "origin",
      pushBranch: false,
      confirm: true,
    };

    const first = service.publish({ ...baseInput, sourceBranch: "codex/one" });
    const second = service.publish({
      ...baseInput,
      sourceBranch: "codex/two",
      remoteName: "upstream",
      pushBranch: true,
    });
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    releasePublish();
    const [firstResult, secondResult] = (await Promise.all([first, second])) as [
      { result: { result: { request: { sourceBranch: string } } } },
      { result: { result: { request: { sourceBranch: string } } } },
    ];

    expect(publish).toHaveBeenCalledTimes(2);
    expect(firstResult.result.result.request.sourceBranch).toBe("codex/one");
    expect(secondResult.result.result.request.sourceBranch).toBe("codex/two");
  });

  it.each([
    { name: "failed", partial: false },
    { name: "partially synchronized", partial: true },
  ])("retries a $name blocked diagnostic result", async ({ partial }) => {
    const { runId } = await prepareBlockedWorkflow(service, directory);
    const report = await service.ensureBlockedDiagnosticReport({ runId });
    const request = {
      host: "github" as const,
      url: "https://github.com/acme/spec-to-pr/pull/123",
      number: "123",
      draft: true,
      sourceBranch: "codex/blocked-diagnostic",
      targetBranch: "main",
      created: true,
      updated: false,
    };
    const unsynchronizedResult = {
      runId,
      status: partial ? ("blocked" as const) : ("failed" as const),
      reportArtifactId: report.id,
      ...(partial ? { request } : {}),
      requestSynced: partial,
      visualPreviewExpected: partial,
      visualPreviewSynced: false,
      featureVideoExpected: false,
      featureVideoSynced: false,
      fallbackMode: "none" as const,
      partialReasons: [partial ? "visual preview is not synchronized" : "publisher failed"],
      errorCode: partial ? "PUBLISH_PARTIAL_SYNC" : "PUBLISH_FAILED",
      errorMessage: partial ? "visual preview is not synchronized" : "publisher failed",
      publishedAssets: [],
      retryable: true,
      publishedAt: new Date().toISOString(),
    };
    const evidenceId = await appendPublishResultArtifact(
      store,
      artifactStore,
      runId,
      unsynchronizedResult,
    );
    const publish = vi.fn().mockResolvedValue({
      result: unsynchronizedResult,
      publishResultArtifactId: evidenceId,
    });
    service = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
    });
    const input = {
      runId,
      intent: "blocked-diagnostic" as const,
      mode: "execute" as const,
      sourceBranch: "codex/blocked-diagnostic",
      confirm: true,
    };

    await service.publish(input);
    await service.publish(input);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(
      (await store.get(runId)).artifacts.filter(
        (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
      ),
    ).toHaveLength(1);
  });

  it("publishes a blocked diagnostic as evidence without advancing report or publish", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts that need an approval",
      scope: "non-ui",
      publication: "draft",
    });
    const blocked = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "Approval is missing.",
        blocker: {
          stage: "contracts",
          code: "MISSING_APPROVAL",
          kind: "missing-input",
          summary: "Approval is missing.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: [],
          attemptedRecovery: [],
          unrunValidations: ["functional"],
          exactUnblockAction: "Provide approval.",
        },
      },
    });
    const stagesBefore = (await store.get(started.runId)).stages;
    const previousGithubToken = process.env["GITHUB_TOKEN"];
    process.env["GITHUB_TOKEN"] = "ghp_test_token";
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const reviewPublisher = new WorkflowFakePublisher(createGate);
    const publisherGitHead = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory })
    ).stdout.trim();
    const publisherService = new PublisherService(
      store,
      artifactStore,
      () => new Date(Date.now() + 60_000).toISOString(),
      { github: reviewPublisher, gitlab: reviewPublisher },
      async (_cwd, args) => {
        if (args[0] === "status") return { stdout: "", stderr: "" };
        if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
        if (args[0] === "symbolic-ref") {
          return { stdout: "codex/blocked-diagnostic\n", stderr: "" };
        }
        if (args[0] === "rev-parse") return { stdout: `${publisherGitHead}\n`, stderr: "" };
        return { stdout: "https://github.com/acme/spec-to-pr.git\n", stderr: "" };
      },
    );
    service = new WorkflowService({ ...dependencies, publisherService });

    try {
      const publication = service.publish({
        runId: started.runId,
        intent: "blocked-diagnostic",
        mode: "execute",
        sourceBranch: "codex/blocked-diagnostic",
        pushBranch: false,
        confirm: true,
      });
      await vi.waitFor(() => expect(reviewPublisher.createdPayloads).toHaveLength(1));
      const competingService = new WorkflowService({ ...dependencies, publisherService });
      await expect(
        competingService.publish({
          runId: started.runId,
          intent: "blocked-diagnostic",
          mode: "execute",
          sourceBranch: "codex/blocked-diagnostic",
          pushBranch: false,
          confirm: true,
        }),
      ).resolves.toMatchObject({
        skipped: true,
        reason: "diagnostic-publication-in-progress",
      });
      releaseCreate();
      const response = (await publication) as {
        result: Awaited<ReturnType<PublisherService["publish"]>>;
        status: Awaited<ReturnType<WorkflowService["status"]>>;
      };

      expect(response.status).toMatchObject({
        status: "blocked",
        blockerDetails: blocked.blockerDetails,
        diagnosticPublication: {
          host: "github",
          url: "https://github.com/acme/spec-to-pr/pull/123",
          number: "123",
          created: true,
          updated: false,
          publishResultArtifactId: expect.stringMatching(/^art_/),
        },
      });
      expect((await service.status({ runId: started.runId })).diagnosticPublication).toEqual(
        response.status.diagnosticPublication,
      );
      const persisted = await store.get(started.runId);
      expect(persisted.stages).toEqual(stagesBefore);
      expect(
        persisted.artifacts.some(
          (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
        ),
      ).toBe(true);
      expect(
        persisted.artifacts.filter(
          (artifact) => artifact.metadata["reportKind"] === "publish-result",
        ),
      ).toHaveLength(1);
      const diagnosticReport = persisted.artifacts.find(
        (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
      )!;
      const reusedReport = await service.ensureBlockedDiagnosticReport({ runId: started.runId });
      const afterReportReuse = await store.get(started.runId);
      expect(reusedReport.id).toBe(diagnosticReport.id);
      expect(afterReportReuse.revision).toBe(persisted.revision);
      expect(
        afterReportReuse.artifacts.filter(
          (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
        ),
      ).toHaveLength(1);
      const beforePublishReuse = await store.get(started.runId);
      const reusedPublish = (await service.publish({
        runId: started.runId,
        intent: "blocked-diagnostic",
        mode: "execute",
        sourceBranch: "codex/blocked-diagnostic",
        pushBranch: false,
        confirm: true,
      })) as {
        result: Awaited<ReturnType<PublisherService["publish"]>>;
        status: Awaited<ReturnType<WorkflowService["status"]>>;
      };
      expect(reusedPublish.result.publishResultArtifactId).toBe(
        response.result.publishResultArtifactId,
      );
      expect(reusedPublish.status).toEqual(response.status);
      expect(await store.get(started.runId)).toEqual(beforePublishReuse);
      expect(reviewPublisher.createdPayloads).toHaveLength(1);
      expect(reviewPublisher.updatedMetadata).toHaveLength(0);
      const publishDistinctIdentity = vi.fn().mockResolvedValue(response.result);
      const distinctIdentityService = new WorkflowService({
        ...dependencies,
        publisherService: {
          publish: publishDistinctIdentity,
        } as unknown as PublisherService,
      });
      const baseDistinctInput = {
        runId: started.runId,
        intent: "blocked-diagnostic" as const,
        mode: "execute" as const,
        sourceBranch: "codex/blocked-diagnostic",
        targetBranch: "main",
        remoteName: "origin",
        pushBranch: false,
        confirm: true,
      };
      await distinctIdentityService.publish({
        ...baseDistinctInput,
        sourceBranch: "codex/different-source",
      });
      await distinctIdentityService.publish({
        ...baseDistinctInput,
        targetBranch: "develop",
      });
      await distinctIdentityService.publish({
        ...baseDistinctInput,
        remoteName: "upstream",
      });
      await distinctIdentityService.publish({
        ...baseDistinctInput,
        pushBranch: true,
      });
      expect(publishDistinctIdentity).toHaveBeenCalledTimes(4);
      expect(reviewPublisher.createdPayloads[0]).toMatchObject({
        title: `[Blocked] SpecToPR Run ${started.runId}`,
        labels: ["spec-to-pr", "spec-to-pr:blocked"],
      });

      await service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Approval supplied and requirements normalized.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("parser"),
        },
      });
      await changeSource(directory, "src/parser.ts", "export const parser = 'recovered';\n");
      const implemented = await service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Parser recovered.",
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
          reviewPacketId: reviewPacketId(implemented, "review-functional"),
          verdict: "approved",
          summary: "Recovered implementation passed.",
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

      expect(ready.status).toBe("publish-ready");
      expect(ready.diagnosticPublication).toBeUndefined();

      const readyReport = (await store.get(started.runId)).artifacts.find(
        (artifact) => artifact.metadata["reportIntent"] === "ready",
      )!;
      const newBlockerService = new WorkflowService({
        ...dependencies,
        publisherService: {
          publish: vi.fn().mockResolvedValue({
            result: {
              runId: started.runId,
              status: "blocked",
              requestSynced: false,
              visualPreviewExpected: false,
              visualPreviewSynced: false,
              fallbackMode: "none",
              partialReasons: ["publication precondition is unmet"],
              errorCode: "PUBLISH_PRECONDITION",
              errorMessage: "publication precondition is unmet",
              publishedAssets: [],
              retryable: false,
              publishedAt: new Date().toISOString(),
            },
            publishResultArtifactId: readyReport.id,
          }),
        } as unknown as PublisherService,
      });
      const newlyBlocked = (await newBlockerService.publish({
        runId: started.runId,
        mode: "execute",
        sourceBranch: "codex/blocked-diagnostic",
        pushBranch: false,
        confirm: true,
      })) as { status: Awaited<ReturnType<WorkflowService["status"]>> };
      expect(newlyBlocked.status).toMatchObject({
        status: "blocked",
        blockerDetails: [{ kind: "publish-precondition", stage: "publish" }],
      });
      expect(newlyBlocked.status.diagnosticPublication).toBeUndefined();

      const recovered = (await service.publish({
        runId: started.runId,
        mode: "execute",
        sourceBranch: "codex/blocked-diagnostic",
        pushBranch: false,
        confirm: true,
      })) as { status: Awaited<ReturnType<WorkflowService["status"]>> };
      expect(recovered.status.status).toBe("completed");
      expect(recovered.status.diagnosticPublication).toBeUndefined();
      expect(reviewPublisher.updatedMetadata).toHaveLength(1);
    } finally {
      if (previousGithubToken === undefined) delete process.env["GITHUB_TOKEN"];
      else process.env["GITHUB_TOKEN"] = previousGithubToken;
    }
  });

  it("does not recurse into diagnostic publication for a publish-precondition blocker", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    const readyReport = (await store.get(runId)).artifacts.find(
      (artifact) => artifact.metadata["reportIntent"] === "ready",
    )!;
    service = new WorkflowService({
      ...dependencies,
      publisherService: {
        publish: vi.fn().mockResolvedValue({
          result: {
            runId,
            status: "blocked",
            requestSynced: false,
            visualPreviewExpected: false,
            visualPreviewSynced: false,
            fallbackMode: "none",
            partialReasons: ["publication precondition is unmet"],
            errorCode: "PUBLISH_PRECONDITION",
            errorMessage: "publication precondition is unmet",
            publishedAssets: [],
            retryable: false,
            publishedAt: new Date().toISOString(),
          },
          publishResultArtifactId: readyReport.id,
        }),
      } as unknown as PublisherService,
    });
    const failed = (await service.publish(publishInput(runId))) as {
      status: Awaited<ReturnType<WorkflowService["status"]>>;
    };
    const stagesBeforeDiagnostic = (await store.get(runId)).stages;
    const exactUnblockAction = failed.status.blockerDetails[0]!.exactUnblockAction;
    const plan = vi.fn();
    const publish = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { plan, publish } as unknown as PublisherService,
    });
    const beforePreview = await store.get(runId);

    await expect(
      service.publish({
        runId,
        intent: "blocked-diagnostic",
        mode: "preview",
        sourceBranch: "codex/blocked-diagnostic",
      }),
    ).resolves.toMatchObject({
      willEnsureReport: true,
      eligibleForPublication: false,
      preflightPending: false,
      skipped: true,
      blocker: { kind: "publish-precondition", exactUnblockAction },
    });
    expect(await store.get(runId)).toEqual(beforePreview);

    const response = (await service.publish({
      runId,
      intent: "blocked-diagnostic",
      mode: "execute",
      sourceBranch: "codex/blocked-diagnostic",
      confirm: true,
    })) as {
      skipped: boolean;
      reason: string;
      localReportPath: string;
      exactUnblockAction: string;
      status: Awaited<ReturnType<WorkflowService["status"]>>;
    };

    expect(response).toMatchObject({
      skipped: true,
      reason: "publish-precondition",
      localReportPath: expect.stringMatching(/^artifact:\/\/sha256\//),
      exactUnblockAction,
      status: { status: "blocked" },
    });
    expect(response.status.diagnosticPublication).toBeUndefined();
    expect(plan).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    const persisted = await store.get(runId);
    expect(persisted.stages).toEqual(stagesBeforeDiagnostic);
    expect(
      persisted.artifacts.some(
        (artifact) => artifact.metadata["reportIntent"] === "blocked-diagnostic",
      ),
    ).toBe(true);
  });

  it("retries ready publication with the passed report after a precondition diagnostic", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    const readyReport = (await store.get(runId)).artifacts.find(
      (artifact) => artifact.metadata["reportIntent"] === "ready",
    )!;
    service = new WorkflowService({
      ...dependencies,
      publisherService: {
        publish: vi.fn().mockResolvedValue({
          result: {
            runId,
            status: "blocked",
            requestSynced: false,
            visualPreviewExpected: false,
            visualPreviewSynced: false,
            fallbackMode: "none",
            partialReasons: ["publication precondition is unmet"],
            errorCode: "PUBLISH_PRECONDITION",
            errorMessage: "publication precondition is unmet",
            publishedAssets: [],
            retryable: false,
            publishedAt: new Date().toISOString(),
          },
          publishResultArtifactId: readyReport.id,
        }),
      } as unknown as PublisherService,
    });
    await service.publish(publishInput(runId));
    await service.publish({
      runId,
      intent: "blocked-diagnostic",
      mode: "execute",
      sourceBranch: "codex/fast-workflow-v2",
      confirm: true,
    });

    const publish = vi.fn().mockResolvedValue({
      result: {
        runId,
        status: "passed",
        requestSynced: true,
        request: {
          host: "github",
          url: "https://github.com/acme/spec-to-pr/pull/123",
          number: "123",
          draft: true,
          sourceBranch: "codex/fast-workflow-v2",
          targetBranch: "main",
          created: false,
          updated: true,
        },
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        fallbackMode: "none",
        partialReasons: [],
        publishedAssets: [],
        retryable: false,
        publishedAt: new Date().toISOString(),
      },
      publishResultArtifactId: readyReport.id,
    });
    service = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
    });

    const currentReadyReport = [...(await store.get(runId)).artifacts]
      .reverse()
      .find((artifact) => artifact.metadata["reportIntent"] === "ready")!;
    const retried = (await service.publish(publishInput(runId))) as {
      status: Awaited<ReturnType<WorkflowService["status"]>>;
    };

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "ready",
        reportArtifactId: currentReadyReport.id,
        confirm: true,
      }),
    );
    expect(retried.status.status).toBe("completed");
  });

  it("starts compactly and stops at the contracts boundary", async () => {
    const inspectProject = vi.fn();
    service = new WorkflowService(
      Object.assign({}, dependencies, {
        profileService: { inspectProject },
      }) as WorkflowServiceDependencies,
    );
    const status = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser and add unit tests",
      scope: "non-ui",
    });

    expect(status.stages).toHaveLength(8);
    expect(status.stages[0]).toEqual({ name: "intake", status: "passed" });
    expect(status.nextActions).toEqual([{ kind: "prepare-contracts", runId: status.runId }]);
    expect(status.workload).toMatchObject({
      confidence: "low",
      source: "intake",
      budget: { checkpointPercent: 80 },
    });
    expect(status.workload.tokenRange.max).toBeGreaterThan(status.workload.tokenRange.min);
    expect(status.delegationPolicy).toMatchObject({
      singleWriter: true,
      allowNested: false,
      maxReadOnlyScouts: expect.any(Number),
      parallelReviewers: expect.any(Boolean),
    });
    expect(status.blockerDetails).toEqual([]);
    expect(status.requiredValidations).toEqual(["functional", "draft-publication-preflight"]);
    expect(status.resumeContext).toMatchObject({
      goal: "Refactor the parser and add unit tests",
      evidencePaths: [],
      submissions: [],
    });
    expect(status).not.toHaveProperty("artifactIds");
    expect(status).not.toHaveProperty("sources");
    expect(status).not.toHaveProperty("evidence");
    expect(status).not.toHaveProperty("agentResults");
    expect(inspectProject).not.toHaveBeenCalled();
  });

  it("maps typed and legacy submission failures into safe blocker details", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts that require an external approval",
      scope: "non-ui",
      publication: "none",
    });
    const blocker = {
      stage: "contracts",
      code: "MISSING_APPROVAL",
      kind: "missing-input",
      summary: "A required approval is missing.",
      retryable: false,
      resumable: true,
      completedWork: ["The request was classified."],
      evidencePaths: [],
      attemptedRecovery: ["Checked the supplied contract sources."],
      unrunValidations: ["functional"],
      exactUnblockAction: "Provide the approval and resubmit the contracts stage.",
    } as const;

    const blocked = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "Waiting for approval.",
        blocker,
      },
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockerDetails).toEqual([
      {
        stage: "contracts",
        code: "MISSING_INPUT",
        kind: "missing-input",
        summary: "The contracts stage stopped because required input is missing.",
        retryable: false,
        resumable: true,
        completedWork: ["intake stage passed."],
        evidencePaths: [],
        attemptedRecovery: [],
        unrunValidations: ["functional"],
        exactUnblockAction: "Provide the missing input and resume contracts.",
      },
    ]);
    expect(blocked.blockers).toEqual([blocked.blockerDetails[0]!.summary]);

    const legacy = await service.start({
      projectRoot: directory,
      requestText: "A raw prompt marker that must never appear in blocker status",
      scope: "non-ui",
      publication: "none",
    });
    const unsafeLegacySummary =
      "RAW_TRANSCRIPT sk-secret-token /Users/private/project requested prompt text";
    const legacyBlocked = await service.submit({
      runId: legacy.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: unsafeLegacySummary,
      },
    });
    expect(legacyBlocked.blockerDetails).toHaveLength(1);
    expect(legacyBlocked.blockerDetails[0]).toMatchObject({
      stage: "contracts",
      code: "WORKFLOW_BLOCKED",
      kind: "unexpected",
      retryable: false,
    });
    expect(legacyBlocked.blockers).toEqual([legacyBlocked.blockerDetails[0]!.summary]);
    expect(JSON.stringify(legacyBlocked.blockerDetails)).not.toContain("RAW_TRANSCRIPT");
    expect(JSON.stringify(legacyBlocked.blockerDetails)).not.toContain("sk-secret-token");
    expect(JSON.stringify(legacyBlocked.blockerDetails)).not.toContain("/Users/private");

    const unsafeTyped = await service.start({
      projectRoot: directory,
      requestText: "Prepare another contract",
      scope: "non-ui",
      publication: "none",
    });
    const unsafeTypedStatus = await service.submit({
      runId: unsafeTyped.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "Sanitize the typed blocker.",
        artifactPaths: ["test-results/unit.json"],
        blocker: {
          ...blocker,
          code: "AWS_SECRET_ACCESS_KEY_IDENTIFIER_SHAPED_SECRET",
          summary: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
          completedWork: ["Read /root/.ssh/id_rsa"],
          attemptedRecovery: [String.raw`Connected to \\server\private\share`],
          unrunValidations: ["AKIAIOSFODNN7EXAMPLE"],
          exactUnblockAction: String.raw`Open C:\Users\private\.ssh\id_rsa`,
          evidencePaths: ["test-results/unit.json"],
        },
      },
    });
    const serializedTypedBlocker = JSON.stringify(unsafeTypedStatus.blockerDetails);
    const unsafeTypedRun = await store.get(unsafeTyped.runId);
    const submissionArtifact = [...unsafeTypedRun.artifacts]
      .reverse()
      .find((item) => item.metadata["workflowSubmissionKind"] === "contracts")!;
    const persistedContent = (await artifactStore.readContent(submissionArtifact.digest)).toString(
      "utf8",
    );
    const durableOutput = `${serializedTypedBlocker}\n${persistedContent}\n${JSON.stringify(submissionArtifact.metadata)}`;
    for (const sensitiveValue of [
      "Authorization",
      "eyJhbGciOiJIUzI1NiJ9",
      "/root/.ssh",
      String.raw`\\server\private\share`,
      String.raw`C:\Users\private`,
      "AKIAIOSFODNN7EXAMPLE",
      "AWS_SECRET_ACCESS_KEY_IDENTIFIER_SHAPED_SECRET",
    ]) {
      expect(durableOutput).not.toContain(sensitiveValue);
    }
    expect(JSON.parse(persistedContent)).toMatchObject({
      summary: "The contracts stage stopped because required input is missing.",
      blocker: {
        stage: "contracts",
        code: "MISSING_INPUT",
        kind: "missing-input",
        completedWork: ["intake stage passed."],
        evidencePaths: ["test-results/unit.json"],
        attemptedRecovery: [],
        unrunValidations: ["functional"],
        exactUnblockAction: "Provide the missing input and resume contracts.",
      },
    });
    expect(submissionArtifact.metadata).toMatchObject({
      summary: "The contracts stage stopped because required input is missing.",
      workflowStageAttempt: 0,
    });
  });

  it("filters secret-shaped artifact paths from resume and derived blocker status", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts without exposing credential values",
      scope: "non-ui",
      publication: "none",
    });
    const run = await store.get(started.runId);
    const template = run.artifacts[0]!;
    const safePath = "test-results/token-validation.json";
    const secretPath = "test-results/access_token=ghp_1234567890abcdef.json";
    await store.save(
      {
        ...run,
        revision: run.revision + 1,
        updatedAt: new Date(Date.parse(run.updatedAt) + 1_000).toISOString(),
        artifacts: [
          ...run.artifacts,
          ArtifactRefSchema.parse({
            ...template,
            id: createArtifactId(),
            metadata: { projectRelativePath: safePath },
          }),
          ArtifactRefSchema.parse({
            ...template,
            id: createArtifactId(),
            metadata: { projectRelativePath: secretPath },
          }),
        ],
      },
      run.revision,
    );
    const startedStage = await dependencies.stageService.start({
      runId: started.runId,
      stageName: "contracts",
      workerId: "durable-test-worker",
    });
    await dependencies.stageService.fail({
      runId: started.runId,
      stageName: "contracts",
      workerId: "durable-test-worker",
      leaseId: startedStage.stage.lease!.id,
      error: {
        code: "UNEXPECTED_RUNTIME_ERROR",
        message: "A private dependency failed.",
        retryable: false,
      },
    });

    const status = await service.status({ runId: started.runId });
    expect(status.resumeContext.evidencePaths).toContain(safePath);
    expect(status.blockerDetails[0]?.evidencePaths).toContain(safePath);
    expect(JSON.stringify(status)).not.toContain(secretPath);
  });

  it("rejects secret-shaped typed blocker evidence before durable persistence", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts without persisting a token value",
      scope: "non-ui",
      publication: "none",
    });
    const before = await store.get(started.runId);
    for (const secretPath of [
      "proof/GITHUB_TOKEN=ghp_1234567890abcdef.txt",
      "proof/x-GITHUB_TOKEN=ghp_1234567890abcdef.txt",
      "proof/(GITHUB_TOKEN=ghp_1234567890abcdef).txt",
      "proof/GITHUB_TOKEN%2525253Dghp_1234567890abcdef.txt",
    ]) {
      await expect(
        service.submit({
          runId: started.runId,
          submission: {
            kind: "contracts",
            status: "blocked",
            summary: "Approval is missing.",
            blocker: {
              stage: "contracts",
              code: "MISSING_APPROVAL",
              kind: "missing-input",
              summary: "Approval is missing.",
              retryable: false,
              resumable: true,
              completedWork: [],
              evidencePaths: [secretPath],
              attemptedRecovery: [],
              unrunValidations: ["functional"],
              exactUnblockAction: "Provide approval.",
            },
          },
        }),
      ).rejects.toThrow(/safe project-relative paths/);
      const after = await store.get(started.runId);
      expect(after).toEqual(before);
      expect(JSON.stringify(after)).not.toContain(secretPath);
    }
  });

  it.each([
    "proof/GITHUB_TOKEN-abcdef1234567890.txt",
    "proof/password-supersecretvalue.txt",
    "proof/token-abcdef1234567890.txt",
  ])("rejects unsafe ingested evidence path %s before writing any blob", async (secretPath) => {
    const absolutePath = path.join(directory, secretPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "non-empty evidence\n", "utf8");
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts with bounded durable evidence names",
      scope: "non-ui",
      publication: "none",
    });
    const before = await store.get(started.runId);

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "blocked",
          summary: "Evidence cannot be accepted.",
          artifactPaths: [secretPath],
        },
      }),
    ).rejects.toThrow(/safe durable evidence path/i);

    const after = await store.get(started.runId);
    expect(after).toEqual(before);
    expect(JSON.stringify(await service.status({ runId: started.runId }))).not.toContain(
      secretPath,
    );
    for (const artifact of after.artifacts) {
      expect(JSON.stringify(artifact.metadata)).not.toContain(secretPath);
      expect(JSON.stringify(await artifactStore.readMetadata(artifact.digest))).not.toContain(
        secretPath,
      );
      expect((await artifactStore.readContent(artifact.digest)).toString("utf8")).not.toContain(
        secretPath,
      );
    }
  });

  it("rejects a secret-shaped symlink alias before the safe target can be ingested", async () => {
    const aliasPath = "proof/token-abcdef1234567890.txt";
    const absoluteAliasPath = path.join(directory, aliasPath);
    await mkdir(path.dirname(absoluteAliasPath), { recursive: true });
    await symlink(path.join(directory, "test-results/unit.json"), absoluteAliasPath);
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts without persisting unsafe symlink aliases",
      scope: "non-ui",
      publication: "none",
    });
    const before = await store.get(started.runId);

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "blocked",
          summary: "Evidence cannot be accepted.",
          artifactPaths: [aliasPath],
        },
      }),
    ).rejects.toThrow(/safe durable evidence path/i);

    const after = await store.get(started.runId);
    expect(after).toEqual(before);
    expect(JSON.stringify(await service.status({ runId: started.runId }))).not.toContain(aliasPath);
    for (const artifact of after.artifacts) {
      expect(JSON.stringify(artifact.metadata)).not.toContain(aliasPath);
      expect(JSON.stringify(await artifactStore.readMetadata(artifact.digest))).not.toContain(
        aliasPath,
      );
      expect((await artifactStore.readContent(artifact.digest)).toString("utf8")).not.toContain(
        aliasPath,
      );
    }
  });

  it("rejects an absolute artifact path before the original value can reach a submission blob", async () => {
    const absoluteEvidencePath = path.join(directory, "test-results/unit.json");
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts with project-relative durable evidence",
      scope: "non-ui",
      publication: "none",
    });
    const before = await store.get(started.runId);

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "blocked",
          summary: "Evidence cannot be accepted.",
          artifactPaths: [absoluteEvidencePath],
        },
      }),
    ).rejects.toThrow(/project-relative durable evidence path/i);

    const after = await store.get(started.runId);
    expect(after).toEqual(before);
    expect(after.artifacts).toHaveLength(before.artifacts.length);
    expect(
      after.artifacts.some(
        (artifact) => artifact.metadata["projectRelativePath"] === absoluteEvidencePath,
      ),
    ).toBe(false);
  });

  it.each([
    "proof/GITHUB_TOKEN-abcdef1234567890.txt",
    "proof/password-supersecretvalue.txt",
    "proof/token-abcdef1234567890.txt",
  ])(
    "never persists separator-form blocker evidence %s even when the file is supplied",
    async (secretPath) => {
      const absolutePath = path.join(directory, secretPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "non-empty secret-shaped evidence\n", "utf8");
      const started = await service.start({
        projectRoot: directory,
        requestText: "Prepare contracts without leaking evidence filenames",
        scope: "non-ui",
        publication: "none",
      });
      const before = await store.get(started.runId);

      await expect(
        service.submit({
          runId: started.runId,
          submission: {
            kind: "contracts",
            status: "blocked",
            summary: "Evidence cannot be accepted.",
            artifactPaths: [secretPath],
            blocker: {
              stage: "contracts",
              code: "UNSAFE_EVIDENCE",
              kind: "verification",
              summary: "Evidence cannot be accepted.",
              retryable: false,
              resumable: true,
              completedWork: [],
              evidencePaths: [secretPath],
              attemptedRecovery: [],
              unrunValidations: ["functional"],
              exactUnblockAction: "Supply evidence under a non-sensitive filename.",
            },
          },
        }),
      ).rejects.toThrow(/safe project-relative paths/i);

      const after = await store.get(started.runId);
      expect(after).toEqual(before);
      expect(JSON.stringify(await service.status({ runId: started.runId }))).not.toContain(
        secretPath,
      );
      for (const artifact of after.artifacts) {
        expect(JSON.stringify(artifact.metadata)).not.toContain(secretPath);
        expect(JSON.stringify(await artifactStore.readMetadata(artifact.digest))).not.toContain(
          secretPath,
        );
        expect((await artifactStore.readContent(artifact.digest)).toString("utf8")).not.toContain(
          secretPath,
        );
      }
    },
  );

  it("persists typed blocker evidence only when it exactly matches ingested artifacts", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts with bounded evidence",
      scope: "non-ui",
      publication: "none",
    });
    const knownPath = "test-results/unit.json";
    const arbitraryPath = "proof/uncollected-result.json";

    const status = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "Approval is missing.",
        artifactPaths: [knownPath],
        blocker: {
          stage: "contracts",
          code: "MISSING_APPROVAL",
          kind: "missing-input",
          summary: "Approval is missing.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: [knownPath, arbitraryPath],
          attemptedRecovery: [],
          unrunValidations: ["functional"],
          exactUnblockAction: "Provide approval.",
        },
      },
    });

    expect(status.blockerDetails[0]?.evidencePaths).toEqual([knownPath]);
    const run = await store.get(started.runId);
    const submissionArtifact = [...run.artifacts]
      .reverse()
      .find((artifact) => artifact.metadata["workflowSubmissionKind"] === "contracts")!;
    const persisted = (await artifactStore.readContent(submissionArtifact.digest)).toString("utf8");
    expect(persisted).toContain(knownPath);
    expect(persisted).not.toContain(arbitraryPath);
    expect(JSON.stringify(submissionArtifact.metadata)).not.toContain(arbitraryPath);
  });

  it("generates one idempotent blocked diagnostic without advancing the report stage", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare contracts that need an approval",
      scope: "non-ui",
      publication: "draft",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "Approval is missing.",
        blocker: {
          stage: "contracts",
          code: "MISSING_APPROVAL",
          kind: "missing-input",
          summary: "Approval is missing.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: [],
          attemptedRecovery: [],
          unrunValidations: ["functional"],
          exactUnblockAction: "Provide approval.",
        },
      },
    });
    const blockedRun = await store.get(started.runId);
    const reportStageBefore = blockedRun.stages.find((item) => item.name === "report")!;

    const [first, second] = await Promise.all([
      service.ensureBlockedDiagnosticReport({ runId: started.runId }),
      service.ensureBlockedDiagnosticReport({ runId: started.runId }),
    ]);

    expect(second.id).toBe(first.id);
    const reportedRun = await store.get(started.runId);
    const diagnostics = reportedRun.artifacts.filter(
      (artifact) =>
        artifact.kind === "pr-report" && artifact.metadata["reportIntent"] === "blocked-diagnostic",
    );
    expect(diagnostics).toHaveLength(1);
    expect(first.metadata).toMatchObject({
      adapter: "pr-report-v2",
      reportKind: "pr-body-markdown",
      reportIntent: "blocked-diagnostic",
      decision: "blocked",
      blockedStage: "contracts",
      errorCode: "MISSING_INPUT",
      blockedStageAttempt: 0,
      sourceRunRevision: blockedRun.revision,
      idempotencyKey: "contracts:0:MISSING_INPUT",
    });
    expect(reportedRun.revision).toBe(blockedRun.revision + 1);
    expect(reportedRun.stages.find((item) => item.name === "report")).toEqual(reportStageBefore);
    const markdown = (await artifactStore.readContent(first.digest)).toString("utf8");
    expect(markdown).toContain("| 상태 | 차단 |");
    expect(markdown).toContain("검증이 차단되어 구현·리뷰가 완료되지 않았습니다.");
    expect(markdown).toContain("## 확인 필요");
    expect(markdown).toContain("| 재개 | Provide the missing input and resume contracts. |");
    expect(markdown).toContain("## 롤백");
    expect(markdown).not.toContain(directory);
    const jsonArtifact = reportedRun.artifacts.find(
      (artifact) => artifact.id === first.metadata["reportJsonArtifactId"],
    );
    if (jsonArtifact === undefined) throw new Error("Missing blocked pr-report-v2 JSON");
    expect(
      JSON.parse((await artifactStore.readContent(jsonArtifact.digest)).toString("utf8")),
    ).toMatchObject({
      schemaVersion: "pr-report-v2.1",
      decision: "blocked",
      sectionStatuses: {
        api: "not-applicable",
        legacy: "not-applicable",
        visual: "not-applicable",
        "functional-review": "not-run",
        "design-review": "not-applicable",
        performance: "not-applicable",
        "feature-evidence": "not-applicable",
      },
    });
  });

  it("reports only genuinely remaining validations in a late design blocker diagnostic", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Update the checkout screen",
      scope: "ui",
      publication: "draft",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Checkout requirements ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout"),
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'late-blocker';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Checkout updated.",
        apiReady: false,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    expect(implemented.nextActions.map((action) => action.kind)).toEqual(["review-functional"]);
    const functionallyReviewed = await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
        verdict: "approved",
        summary: "Functional validation passed.",
        findings: [],
        requirements: [{ id: "checkout", verdict: "accepted" }],
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
    const blocked = await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        reviewPacketId: reviewPacketId(functionallyReviewed, "review-design"),
        verdict: "blocked",
        summary: "Design review needs an external tool.",
        findings: [],
        requirements: [{ id: "checkout", verdict: "blocked" }],
        artifactPaths: ["visual/diff.png"],
        gateResults: [
          {
            id: "visual",
            status: "passed",
            evidencePaths: ["visual/diff.png"],
          },
          {
            id: "accessibility",
            status: "passed",
            evidencePaths: ["visual/diff.png"],
          },
        ],
        blocker: {
          stage: "design-review",
          code: "MISSING_DESIGN_TOOL",
          kind: "missing-tool",
          summary: "The design tool is unavailable.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: ["visual/diff.png"],
          attemptedRecovery: [],
          unrunValidations: [],
          exactUnblockAction: "Enable the design tool and resume design review.",
        },
      },
    });

    expect(blocked.blockerDetails[0]?.unrunValidations).toEqual(["draft-publication-preflight"]);
    const diagnostic = await service.ensureBlockedDiagnosticReport({ runId: started.runId });
    const markdown = (await artifactStore.readContent(diagnostic.digest)).toString("utf8");
    const unrunSection = markdown.slice(
      markdown.indexOf("## 확인 필요"),
      markdown.indexOf("## 롤백"),
    );
    expect(unrunSection).toContain("| 미실행 | draft-publication-preflight |");
    expect(unrunSection).not.toContain("| 미실행 | functional |");
    expect(unrunSection).not.toContain("| 미실행 | accessibility |");
    expect(markdown).toContain("| 기능 리뷰 | 승인 | 1/1 통과 | 0건 |");
  });

  it("omits stale packet, review, visual, and changed-file claims from blocked reports", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Update the checkout screen",
      scope: "ui",
      publication: "draft",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Checkout requirements ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout"),
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'reviewed';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Checkout updated.",
        apiReady: false,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    const functionallyReviewed = await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
        verdict: "approved",
        summary: "Old functional review passed.",
        findings: [],
        requirements: [{ id: "checkout", verdict: "accepted" }],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [
          { id: "functional", status: "passed", evidencePaths: ["test-results/unit.json"] },
        ],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        reviewPacketId: reviewPacketId(functionallyReviewed, "review-design"),
        verdict: "blocked",
        summary: "Design tooling is unavailable.",
        findings: [],
        requirements: [{ id: "checkout", verdict: "blocked" }],
        artifactPaths: ["visual/diff.png"],
        gateResults: [
          { id: "visual", status: "passed", evidencePaths: ["visual/diff.png"] },
          { id: "accessibility", status: "passed", evidencePaths: ["visual/diff.png"] },
        ],
        blocker: {
          stage: "design-review",
          code: "MISSING_DESIGN_TOOL",
          kind: "missing-tool",
          summary: "The design tool is unavailable.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: ["visual/diff.png"],
          attemptedRecovery: [],
          unrunValidations: [],
          exactUnblockAction: "Enable the design tool and rerun both current-diff reviews.",
        },
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'changed-again';\n");

    const markdownArtifact = await service.ensureBlockedDiagnosticReport({ runId: started.runId });
    const reportedRun = await store.get(started.runId);
    const jsonArtifact = reportedRun.artifacts.find(
      (artifact) => artifact.id === markdownArtifact.metadata["reportJsonArtifactId"],
    );
    if (jsonArtifact === undefined) throw new Error("Missing blocked report JSON");
    const report = JSON.parse(
      (await artifactStore.readContent(jsonArtifact.digest)).toString("utf8"),
    ) as Record<string, unknown>;

    expect(report).not.toHaveProperty("binding");
    expect(report).toMatchObject({
      changedFiles: [],
      reviews: [],
      visual: { status: "not-applicable", results: [] },
      sectionStatuses: {
        "functional-review": "not-run",
        "design-review": "not-run",
      },
    });
    expect(JSON.stringify(report)).not.toContain("Old functional review passed.");
  });

  it("reports a second zero-based stage execution as two attempts", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Prepare retryable contracts",
      scope: "non-ui",
      publication: "none",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "failed",
        summary: "The first contract attempt failed.",
      },
    });

    const second = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "blocked",
        summary: "The second contract attempt is blocked.",
        blocker: {
          stage: "contracts",
          code: "MISSING_APPROVAL",
          kind: "missing-input",
          summary: "Approval is missing.",
          retryable: false,
          resumable: true,
          completedWork: [],
          evidencePaths: [],
          attemptedRecovery: [],
          unrunValidations: [],
          exactUnblockAction: "Provide approval and resume contracts.",
        },
      },
    });

    expect(second.blockerDetails[0]?.attemptedRecovery).toEqual([
      "The contracts stage was attempted 2 times.",
    ]);
  });

  it("derives unexpected for legacy review blockers without typed details", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser",
      scope: "non-ui",
      publication: "none",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Parser requirements ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("parser"),
      },
    });
    await changeSource(directory, "src/parser.ts", "export const parser = 'review';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Parser refactored.",
        apiReady: false,
        uiChanged: false,
        changedFiles: ["src/parser.ts"],
        artifactPaths: ["test-results/unit.json"],
      },
    });

    const blocked = await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
        verdict: "blocked",
        summary: "Legacy review payload without structured details.",
      },
    });

    expect(blocked.blockerDetails).toEqual([
      expect.objectContaining({
        stage: "functional-review",
        code: "WORKFLOW_BLOCKED",
        kind: "unexpected",
      }),
    ]);
  });

  it("does not reuse a stale typed blocker for a later durable stage failure", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser",
      scope: "non-ui",
      publication: "none",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Parser requirements ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("parser"),
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "failed",
        summary: "The tool was unavailable.",
        apiReady: false,
        uiChanged: false,
        blocker: {
          stage: "implementation",
          code: "MISSING_PRIVATE_TOOL_NAME",
          kind: "missing-tool",
          summary: "Private tool details.",
          retryable: true,
          resumable: true,
          completedWork: [],
          evidencePaths: [],
          attemptedRecovery: [],
          unrunValidations: [],
          exactUnblockAction: "Enable the private tool.",
        },
      },
    });
    const restarted = await dependencies.stageService.start({
      runId: started.runId,
      stageName: "implementation",
      workerId: "durable-test-worker",
    });
    await dependencies.stageService.fail({
      runId: started.runId,
      stageName: "implementation",
      workerId: "durable-test-worker",
      leaseId: restarted.stage.lease!.id,
      error: {
        code: "UNEXPECTED_RUNTIME_ERROR",
        message: "Authorization: Bearer durable-secret",
        retryable: false,
      },
    });

    const status = await service.status({ runId: started.runId });
    expect(status.blockerDetails).toEqual([
      expect.objectContaining({
        stage: "implementation",
        code: "UNEXPECTED_BLOCKER",
        kind: "unexpected",
      }),
    ]);
    expect(JSON.stringify(status.blockerDetails)).not.toContain("MISSING_PRIVATE_TOOL_NAME");
    expect(JSON.stringify(status.blockerDetails)).not.toContain("durable-secret");
  });

  it("recommends skills deterministically from intake evidence without blocking", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(
      path.join(directory, "docs", "openapi.yaml"),
      "openapi: 3.1.0\npaths:\n  /checkout:\n    post:\n      responses: {}\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }),
      "utf8",
    );

    const status = await service.start({
      projectRoot: directory,
      requestText: "Build the checkout feature from Figma and OpenAPI",
      scope: "ui",
      mode: "feature",
      changeKind: "feature",
      publication: "none",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
    });

    expect(status.deliveryProfile.recommendedSkills).toEqual([
      "figma",
      "design-system",
      "api-generator",
      "react-best-practices",
      "next-best-practices",
      "playwright",
    ]);
  });

  it("reopens implementation when a stale current packet is rejected", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Restyle the checkout form and its empty state",
      scope: "ui",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Checkout states are specified.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: [
          {
            id: "checkout-state",
            title: "Checkout empty state",
            acceptanceCriteria: ["The empty state matches the approved contract."],
          },
        ],
      },
    });
    await changeSource(directory, "src/checkout.tsx", "implemented checkout state\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Checkout state implemented.",
        apiReady: false,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    const packetId = implemented.nextActions.find(
      (action) => action.kind === "review-functional",
    )?.reviewPacketId;
    expect(packetId).toMatch(/^packet_[a-f0-9]{64}$/);
    if (packetId === undefined) throw new Error("Missing review packet");

    await changeSource(directory, "src/checkout.tsx", "mutated after packet creation\n");
    const reopened = await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: packetId,
        verdict: "changes-requested",
        summary: "The packet is stale because the empty-state repair changed the source.",
        findings: [{ severity: "major", title: "Stale implementation packet", evidence: [] }],
        requirements: [{ id: "checkout-state", verdict: "rejected" }],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [],
      },
    });

    expect(reopened.nextActions).toEqual([
      { kind: "implement", runId: started.runId, requireApiReady: false },
    ]);
    expect(reopened.blockerDetails).toEqual([
      expect.objectContaining({ stage: "implementation", kind: "unexpected" }),
    ]);
    expect(reopened.stages.find((stage) => stage.name === "design-review")?.status).toBe("pending");

    const correlatedRun = await store.get(started.runId);
    await store.save(
      {
        ...correlatedRun,
        revision: correlatedRun.revision + 1,
        artifacts: correlatedRun.artifacts.map((artifact) => {
          if (
            artifact.metadata["workflowSubmissionKind"] !== "functional-review" ||
            artifact.metadata["verdict"] !== "changes-requested"
          ) {
            return artifact;
          }
          const {
            workflowFailureStage: _workflowFailureStage,
            workflowFailureAttempt: _workflowFailureAttempt,
            ...legacyMetadata
          } = artifact.metadata;
          return { ...artifact, metadata: legacyMetadata };
        }),
      },
      correlatedRun.revision,
    );
    const legacyReopened = await service.status({ runId: started.runId });
    expect(legacyReopened.blockerDetails).toEqual([
      expect.objectContaining({
        stage: "implementation",
        code: "REVIEW_CHANGES_REQUESTED",
        kind: "unexpected",
      }),
    ]);

    const repaired = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Checkout state repaired.",
        apiReady: false,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    const repairedPacketId = reviewPacketId(repaired, "review-functional");
    expect(repairedPacketId).not.toBe(packetId);

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "functional-review",
          reviewPacketId: packetId,
          verdict: "changes-requested",
          summary: "Stale packet must not be reviewed.",
          findings: [],
          requirements: [{ id: "checkout-state", verdict: "rejected" }],
          artifactPaths: ["test-results/unit.json"],
          gateResults: [],
        },
      }),
    ).rejects.toThrow(/current implementation review packet/i);
  });

  it("derives the exact changed-file set from Git instead of trusting an agent claim", async () => {
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
        summary: "Parser contract ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("parser"),
      },
    });
    await changeSource(directory, "src/parser.ts", "export const parser = 'changed';\n");

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Parser changed with an incomplete file claim.",
          apiReady: false,
          uiChanged: false,
          changedFiles: [],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow(/changedFiles.*Git diff/i);
  });

  it("counts bounded package roots from pnpm workspace globs without full profiling", async () => {
    await writeFile(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    for (let index = 0; index < 10; index += 1) {
      const packageRoot = path.join(directory, "packages", `package-${index}`);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(path.join(packageRoot, "package.json"), `{"name":"package-${index}"}\n`);
    }

    const status = await service.start({
      projectRoot: directory,
      requestText: "Update one sentence",
    });

    expect(status.workload.score).toBeGreaterThanOrEqual(40);
  });

  it("increases workload for many operations in one OpenAPI source", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    const document = (operationCount: number) => ({
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: Object.fromEntries(
        Array.from({ length: operationCount }, (_, index) => [
          `/items/${index}`,
          { get: { operationId: `getItem${index}`, responses: {} } },
        ]),
      ),
    });
    await writeFile(
      path.join(directory, "docs", "one-operation.json"),
      JSON.stringify(document(1)),
      "utf8",
    );
    await writeFile(
      path.join(directory, "docs", "many-operations.json"),
      JSON.stringify(document(20)),
      "utf8",
    );

    const one = await service.start({
      projectRoot: directory,
      requestText: "Implement the supplied service contract",
      scope: "non-ui",
      openApiPaths: ["docs/one-operation.json"],
    });
    const many = await service.start({
      projectRoot: directory,
      requestText: "Implement the supplied service contract",
      scope: "non-ui",
      openApiPaths: ["docs/many-operations.json"],
    });

    expect(many.workload.score).toBeGreaterThan(one.workload.score);
  });

  it("ingests an HTTPS OpenAPI URL into the same full-delivery contract", async () => {
    const text = "openapi: 3.1.0\npaths:\n  /checkout:\n    post:\n      operationId: checkout\n";
    const fetchOpenApiSource = vi.fn(async ({ url }: { url: string }) => ({
      originalUrl: url,
      resolvedUrl: "https://cdn.example.com/contracts/checkout.yaml",
      mediaType: "application/yaml",
      text,
      sha256: "sha256:" + createHash("sha256").update(text).digest("hex"),
    }));
    service = new WorkflowService({ ...dependencies, fetchOpenApiSource });

    const status = await service.start({
      projectRoot: directory,
      requestText: "Implement checkout from the supplied sources",
      scope: "ui",
      mode: "brief",
      changeKind: "feature",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiUrl: "https://api.example.com/docs",
    });

    expect(fetchOpenApiSource).toHaveBeenCalledWith({
      url: "https://api.example.com/docs",
    });
    expect(status.deliveryProfile).toMatchObject({
      openApiPaths: [],
      openApiUrls: ["https://api.example.com/docs"],
      requirements: { apiCoverage: true },
    });
    expect(status.scope).toMatchObject({ api: true, specification: true });
  });

  it("pins every OpenAPI operation at intake and rejects a partial API-ready inventory", async () => {
    await writeFile(
      path.join(directory, "docs/openapi.yaml"),
      "openapi: 3.1.0\npaths:\n  /checkout:\n    post:\n      operationId: checkout\n      responses: {}\n  /checkout/{id}:\n    get:\n      operationId: checkoutById\n      responses: {}\n",
      "utf8",
    );
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement the full checkout contract",
      scope: "ui",
      mode: "brief",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
    });
    expect(started.deliveryProfile.openApiOperations.map((item) => item.operationKey)).toEqual([
      "POST /checkout",
      "GET /checkout/{id}",
    ]);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Checkout contracts ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout"),
      },
    });

    await expect(submitApiReady(service, started.runId)).rejects.toThrow(/GET \/checkout\/\{id\}/);
  });

  it("makes both XS and XL reachable at intake and reports every required validation", async () => {
    const tiny = await service.start({
      projectRoot: directory,
      requestText: "Update one sentence",
      scope: "docs",
      mode: "auto",
      changeKind: "docs",
      publication: "none",
    });
    const complex = await service.start({
      projectRoot: directory,
      requestText: Array.from(
        { length: 50 },
        (_, index) => `- Requirement ${index + 1}: update the API-backed checkout screen`,
      ).join("\n"),
      scope: "ui",
      mode: "feature",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
    });

    expect(tiny.workload.size).toBe("XS");
    expect(complex.workload.size).toBe("XL");
    expect(complex.requiredValidations).toEqual(
      expect.arrayContaining([
        "functional",
        "visual",
        "accessibility",
        "performance",
        "figma-bundle",
        "visual-comparison",
        "api-coverage",
        "performance-evidence",
        "targeted-feature-e2e",
        "feature-video",
        "api-ready",
        "draft-publication-preflight",
      ]),
    );
  });

  it("refines the intake workload from contract signals without adding a stage", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement the requested API-backed dashboard",
      scope: "ui",
      mode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });

    const refined = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Mapped the concrete change surface.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("dashboard"),
        workloadSignals: {
          requirements: 18,
          relevantFiles: 35,
          apiOperations: 10,
          uiSurfaces: 8,
          figmaNodes: 40,
          testTargets: 12,
          uncertainty: 0,
        },
      },
    });

    expect(refined.stages).toHaveLength(8);
    expect(refined.workload.source).toBe("contracts");
    expect(refined.workload.confidence).toBe("high");
    expect(["L", "XL"]).toContain(refined.workload.size);
    expect(refined.workload.tokenRange.min).toBeGreaterThanOrEqual(started.workload.tokenRange.min);
    expect(refined.resumeContext.goal).toContain("API-backed dashboard");
    expect(refined.resumeContext.evidencePaths).toContain("contracts/requirements.json");
    expect(refined.resumeContext.submissions).toContainEqual({
      kind: "contracts",
      summary: "Mapped the concrete change surface.",
      outcome: "passed",
    });
  });

  it("rejects an overlong project-local brief path before creating a run", async () => {
    const briefPath = `briefs//${"./".repeat(491)}checkout.md`;
    expect(briefPath).toHaveLength(1_001);

    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Implement the supplied product brief",
        mode: "brief",
        briefPath,
        figmaUrl: FIGMA_URL,
        openApiPaths: ["docs/openapi.yaml"],
      }),
    ).rejects.toThrow(/briefPath|1,000|too_big/i);

    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("rejects a short brief alias whose canonical project path is overlong before creating a run", async () => {
    const compactProjectRoot = await mkdtemp("/tmp/s");
    const canonicalBriefPath = projectRelativePathOfLength(1_001);
    const canonicalBrief = path.join(compactProjectRoot, canonicalBriefPath);

    try {
      await mkdir(path.dirname(canonicalBrief), { recursive: true });
      await writeFile(canonicalBrief, "Implement the supplied product brief.\n", "utf8");
      await symlink(canonicalBriefPath, path.join(compactProjectRoot, "brief.md"));
      await mkdir(path.join(compactProjectRoot, "docs"), { recursive: true });
      await writeFile(
        path.join(compactProjectRoot, "docs", "openapi.yaml"),
        "openapi: 3.1.0\npaths: {}\n",
        "utf8",
      );

      await expect(
        service.start({
          projectRoot: compactProjectRoot,
          requestText: "Implement the supplied product brief",
          mode: "brief",
          briefPath: "brief.md",
          figmaUrl: FIGMA_URL,
          openApiPaths: ["docs/openapi.yaml"],
        }),
      ).rejects.toThrow(/briefPath|Source path|1,000|too_big/i);

      await expect(store.list()).resolves.toHaveLength(0);
    } finally {
      await rm(compactProjectRoot, { recursive: true, force: true });
    }
  });

  it("records an explicit delivery profile without adding stages", async () => {
    const status = await service.start({
      projectRoot: directory,
      requestText: "Implement the supplied product brief",
      scope: "auto",
      mode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
    });

    expect(status.stages).toHaveLength(8);
    expect(status.deliveryProfile).toMatchObject({
      mode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
      requirements: {
        visualComparison: true,
        apiCoverage: true,
        performanceEvidence: true,
      },
    });
    expect(status.scope).toMatchObject({ ui: true, api: true });
    const stored = await store.get(status.runId);
    expect(
      stored.sources.some(
        (source) =>
          source.locator.type === "inline" && source.locator.label === "brief:briefs/checkout.md",
      ),
    ).toBe(true);
  });

  it("extracts a PDF brief with page provenance before intake classification", async () => {
    await writeFile(
      path.join(directory, "briefs", "checkout.pdf"),
      minimalTextPdf("Acceptance criterion: the checkout submits exactly once."),
    );

    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement the supplied checkout brief",
      mode: "brief",
      briefPath: "briefs/checkout.pdf",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
    });
    const run = await store.get(started.runId);
    const briefSource = run.sources.find(
      (source) =>
        source.locator.type === "inline" && source.locator.label === "brief:briefs/checkout.pdf",
    );

    expect(briefSource).toBeDefined();
    expect(
      run.evidence.some(
        (evidence) =>
          evidence.sourceId === briefSource!.id &&
          evidence.excerpt?.includes("[Page 1]") === true &&
          evidence.excerpt.includes("checkout submits exactly once"),
      ),
    ).toBe(true);
    expect(JSON.stringify(run.evidence)).not.toContain("%PDF-1.4");
  });

  it("canonicalizes a separate legacy project and forces a visual migration profile", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-"));
    try {
      await writeFile(path.join(legacyRoot, "package.json"), '{"name":"legacy"}\n', "utf8");

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the checkout screen from the legacy project",
        mode: "legacy",
        changeKind: "migration",
      });

      expect(started).toMatchObject({
        scope: { ui: true, hasVisualBaseline: true },
        deliveryProfile: {
          mode: "legacy",
          legacyProjectRoot: await import("node:fs/promises").then(({ realpath }) =>
            realpath(legacyRoot),
          ),
          draftEvidenceBundle: {
            featureSlug: expect.stringMatching(/^spec-to-pr-legacy-/),
            rootPath: expect.stringMatching(/^\.spec-to-pr\/spec-to-pr-legacy-/),
            manifestPath: expect.stringMatching(
              /^\.spec-to-pr\/spec-to-pr-legacy-.*\/manifest\.json$/,
            ),
          },
          publication: "draft",
          requirements: {
            legacyBaseline: true,
            legacyInventory: true,
            visualComparison: true,
            apiCoverage: false,
            performanceEvidence: true,
          },
        },
      });
      expect(started.requiredValidations).toEqual(
        expect.arrayContaining([
          "visual",
          "accessibility",
          "legacy-baseline",
          "legacy-inventory",
          "performance-evidence",
          "draft-publication-preflight",
        ]),
      );
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("derives legacy API operations without requiring a separate OpenAPI source", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-api-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(
        path.join(legacyRoot, "src", "checkout.ts"),
        'export async function submit(){ return checkoutClient.post("/API/Checkout"); }\n',
        "utf8",
      );

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the checkout screen and its existing API integration",
        mode: "legacy",
        changeKind: "migration",
      });

      expect(started.deliveryProfile.openApiPaths).toEqual([]);
      expect(started.deliveryProfile.openApiOperations).toEqual([
        expect.objectContaining({
          operationKey: "POST /API/Checkout",
          path: "/API/Checkout",
          sourceLocator: "external-legacy-project/src/checkout.ts",
        }),
      ]);
      expect(started.deliveryProfile.requirements.apiCoverage).toBe(true);
      expect(started.requiredValidations).toEqual(
        expect.arrayContaining(["api-ready", "api-coverage"]),
      );
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("preserves every legacy gateway origin when equal method paths share one API contract", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-gateways-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(path.join(legacyRoot, "package.json"), '{"name":"legacy-gateways"}\n');
      await writeFile(
        path.join(legacyRoot, ".env"),
        [
          "API_GATEWAY_V1=https://v1.example/api/",
          "API_GATEWAY_V2=https://v2.example/api/",
          "",
        ].join("\n"),
      );
      await writeFile(
        path.join(legacyRoot, ".env.qa"),
        [
          "API_GATEWAY_V1=https://v1.example/api/",
          "API_GATEWAY_V2=https://v2.example/api/",
          "",
        ].join("\n"),
      );
      await writeFile(
        path.join(legacyRoot, "src", "ranking.ts"),
        [
          'import axios from "axios";',
          "const v1 = axios.create({ baseURL: process.env.API_GATEWAY_V1 });",
          "const v2 = axios.create({ baseURL: process.env.API_GATEWAY_V2 });",
          'export const loadLegacyRanking = () => v1.get("/shop/ranking");',
          'export const loadCurrentRanking = () => v2.get("/shop/ranking");',
          "",
        ].join("\n"),
      );
      await writeFile(
        path.join(directory, "docs", "ranking.openapi.yaml"),
        [
          "openapi: 3.1.0",
          "servers:",
          "  - url: https://contract.example/api/",
          "paths:",
          "  /shop/ranking:",
          "    get:",
          "      operationId: getShopRanking",
          "      responses: {}",
          "  /admin:",
          "    delete:",
          "      operationId: deleteAdmin",
          "      responses: {}",
          "",
        ].join("\n"),
      );

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the selected legacy scope",
        mode: "legacy",
        changeKind: "migration",
        openApiPaths: ["docs/ranking.openapi.yaml"],
      });

      expect(started.deliveryProfile.openApiOperations).toEqual([
        expect.objectContaining({
          operationKey: "GET /shop/ranking",
          operationId: "getShopRanking",
          serverOrigins: [
            "https://contract.example/api/",
            "https://v1.example/api/",
            "https://v2.example/api/",
          ],
        }),
      ]);
      expect(started.legacyInventory?.apiCandidates).toHaveLength(2);
      expect(
        started.legacyInventory?.apiCandidates.map((candidate) => candidate.originRef),
      ).toEqual(
        expect.arrayContaining(["process.env:API_GATEWAY_V1", "process.env:API_GATEWAY_V2"]),
      );
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("advances Shop-style legacy API intake from source evidence without OpenAPI or HAR", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-shop-api-"));
    const environmentName = "VUE_APP_API_GW_V2_URL";
    const previousEnvironmentValue = process.env[environmentName];
    process.env[environmentName] = "https://user:password@must-not-appear.invalid/";
    try {
      await mkdir(path.join(legacyRoot, "api"), { recursive: true });
      await mkdir(path.join(legacyRoot, "stores"), { recursive: true });
      await writeFile(
        path.join(legacyRoot, "api", "ghomeApi.js"),
        [
          'import { httpService, defaultHttpService } from "@/api/httpService";',
          "const axiosInstance = new httpService();",
          "const defaultAxiosInstance = new defaultHttpService();",
          "export default {",
          "  getGhomeInfo(rgnNo, useDefault) {",
          "    return useDefault",
          "      ? defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}`)",
          "      : axiosInstance.get(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}`);",
          "  },",
          "  getRecentNoticeList(params) { return defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V2_URL}shop/${params.rgnNo}/notices`); },",
          "  getTournamentList() { return defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V1_URL}shop/glf`); },",
          "  getShopRanking() { return defaultAxiosInstance.get(`${process.env.VUE_APP_API_GW_V1_URL}shop/ranking`); },",
          "  getMyRanking() { return axiosInstance.get(`${process.env.VUE_APP_API_GW_V1_URL}shop/ranking/mine`); },",
          "  deleteFavorite(rgnNo) { return axiosInstance.delete(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}/favorite`); },",
          "  pickFavorite(rgnNo) { return axiosInstance.patch(`${process.env.VUE_APP_API_GW_V2_URL}shop/${rgnNo}/favorite`); },",
          "  getGrxShopImageList(rgnNo) { return axiosInstance.get(`${process.env.VUE_APP_API_GW_LOUNGE_API}v1/franchise-reservation/shops/image/${rgnNo}`); },",
          "};",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(legacyRoot, "stores", "ghome.js"),
        [
          'import ghomeApi from "../api/ghomeApi";',
          "export const actions = {",
          "  info: (rgnNo) => ghomeApi.getGhomeInfo(rgnNo),",
          "  notices: (rgnNo) => ghomeApi.getRecentNoticeList({ rgnNo }),",
          "  tournaments: () => ghomeApi.getTournamentList(),",
          "  ranking: () => ghomeApi.getShopRanking(),",
          "  mine: () => ghomeApi.getMyRanking(),",
          "  images: (rgnNo) => ghomeApi.getGrxShopImageList(rgnNo),",
          "};",
        ].join("\n"),
        "utf8",
      );

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the legacy Shop module",
        mode: "legacy",
        changeKind: "migration",
      });
      const operationKeys = started.deliveryProfile.openApiOperations
        .map((operation) => operation.operationKey)
        .sort();

      expect(started.status).not.toBe("blocked");
      expect(started.nextActions).toEqual([{ kind: "prepare-contracts", runId: started.runId }]);
      expect(started.blockerDetails.map((blocker) => blocker.code)).not.toContain(
        "LEGACY_API_METHOD_UNKNOWN",
      );
      expect(started.deliveryProfile.openApiPaths).toEqual([]);
      expect(started.deliveryProfile.legacyNetworkEvidencePath).toBeUndefined();
      expect(operationKeys).toEqual(
        [
          "DELETE /shop/{rgnNo}/favorite",
          "GET /shop/glf",
          "GET /shop/ranking",
          "GET /shop/ranking/mine",
          "GET /shop/{rgnNo}",
          "GET /shop/{rgnNo}/notices",
          "GET /v1/franchise-reservation/shops/image/{rgnNo}",
          "PATCH /shop/{rgnNo}/favorite",
        ].sort(),
      );
      expect(JSON.stringify(started.legacyInventory)).not.toMatch(/operation:/u);
      expect(started.legacyInventory).toMatchObject({ version: 3, apiState: "detected" });
      expect(started.legacyInventory?.apiCandidates).toHaveLength(8);
      expect(
        new Set(
          started.legacyInventory?.apiCandidates.map((candidate) =>
            candidate.originRef?.replace(/^process\.env:/u, ""),
          ),
        ),
      ).toEqual(
        new Set(["VUE_APP_API_GW_V1_URL", "VUE_APP_API_GW_V2_URL", "VUE_APP_API_GW_LOUNGE_API"]),
      );
      expect(JSON.stringify(await store.get(started.runId))).not.toMatch(
        /must-not-appear|password@/u,
      );
    } finally {
      if (previousEnvironmentValue === undefined) delete process.env[environmentName];
      else process.env[environmentName] = previousEnvironmentValue;
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("resolves an ambiguous legacy API method from uniquely matching OpenAPI", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-api-unknown-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(
        path.join(legacyRoot, "src", "checkout.ts"),
        'export async function load(){ return http.request({ url: "//user:password@api.example/API/Checkout?access_token=do-not-persist#fragment" }); }\n',
        "utf8",
      );

      await writeFile(
        path.join(directory, "docs/openapi.yaml"),
        "openapi: 3.1.0\npaths:\n  /API/Checkout:\n    post:\n      operationId: checkout\n      responses: {}\n",
        "utf8",
      );
      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the checkout API",
        mode: "legacy",
        changeKind: "migration",
        openApiPaths: ["docs/openapi.yaml"],
      });

      expect(started.deliveryProfile.openApiOperations).toEqual([
        expect.objectContaining({ operationKey: "POST /API/Checkout" }),
      ]);
      expect(started.status).not.toBe("blocked");
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("resolves an ambiguous legacy API method from scoped runtime network evidence", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-api-runtime-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(
        path.join(legacyRoot, "src", "checkout.ts"),
        'export async function load(){ return http.request({ url: "/API/Checkout" }); }\n',
        "utf8",
      );
      await mkdir(path.join(directory, "evidence"), { recursive: true });
      await writeFile(
        path.join(directory, "evidence", "legacy.har"),
        JSON.stringify({
          log: {
            entries: [
              {
                request: {
                  method: "POST",
                  url: "https://legacy.example/API/Checkout?access_token=do-not-persist",
                  headers: [{ name: "Authorization", value: "Bearer do-not-persist" }],
                },
              },
            ],
          },
        }),
        "utf8",
      );

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        legacyNetworkEvidencePath: "evidence/legacy.har",
        requestText: "Migrate the checkout API",
        mode: "legacy",
        changeKind: "migration",
      });

      expect(started.status).not.toBe("blocked");
      expect(started.deliveryProfile).toMatchObject({
        legacyNetworkEvidencePath: "evidence/legacy.har",
        openApiOperations: [expect.objectContaining({ operationKey: "POST /API/Checkout" })],
      });
      expect(started.legacyInventory?.apiDiscoveryAdapters).toContain("runtime-network-har");
      expect(JSON.stringify(await store.get(started.runId))).not.toContain("do-not-persist");
      await writeFile(
        path.join(directory, "evidence", "legacy.har"),
        JSON.stringify([{ method: "GET", url: "/API/Checkout" }]),
        "utf8",
      );
      await expect(
        service.submit({
          runId: started.runId,
          submission: {
            kind: "contracts",
            status: "passed",
            summary: "Attempted contracts after changing the pinned network evidence.",
            artifactPaths: ["contracts/requirements.json"],
            requirementManifest: requirements("checkout-api"),
          },
        }),
      ).rejects.toThrow(/LEGACY_RUNTIME_EVIDENCE_CHANGED/);
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed runtime network evidence before creating a durable Run", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-api-runtime-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(path.join(legacyRoot, "src", "checkout.ts"), "export const api = 1;\n");
      await mkdir(path.join(directory, "evidence"), { recursive: true });
      await writeFile(path.join(directory, "evidence", "legacy.har"), "not-json", "utf8");

      await expect(
        service.start({
          projectRoot: directory,
          legacyProjectRoot: legacyRoot,
          legacyNetworkEvidencePath: "evidence/legacy.har",
          requestText: "Migrate the checkout API",
          mode: "legacy",
          changeKind: "migration",
        }),
      ).rejects.toThrow(/JSON/i);
      await expect(store.list()).resolves.toHaveLength(0);
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("persists an unresolved legacy API candidate as a durable intake blocker", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-api-unknown-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(
        path.join(legacyRoot, "src", "checkout.ts"),
        'export async function load(){ return http.request({ url: "//user:password@api.example/API/Checkout?access_token=do-not-persist#fragment" }); }\n',
        "utf8",
      );

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the checkout API",
        mode: "legacy",
        changeKind: "migration",
      });

      expect(started).toMatchObject({
        status: "needs-external-action",
        currentStage: "intake",
        nextActions: [
          {
            kind: "collect-legacy-network-evidence",
            runId: started.runId,
            maxBytes: 1024 * 1024,
            maxRequests: 1_000,
          },
        ],
        blockerDetails: [
          expect.objectContaining({
            code: "LEGACY_API_METHOD_UNKNOWN",
            exactUnblockAction: expect.stringMatching(/OpenAPI|runtime/i),
          }),
        ],
      });
      expect(started.blockerDetails[0]!.exactUnblockAction).toMatch(/same Run/i);
      expect(started.blockerDetails[0]!.exactUnblockAction).not.toMatch(/restart intake/i);
      expect(started.legacyInventory?.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ normalizedKey: "UNKNOWN //api.example/API/Checkout" }),
        ]),
      );
      expect(JSON.stringify(started)).not.toContain("do-not-persist");
      expect(JSON.stringify(started)).not.toContain("password@");
      await mkdir(path.join(directory, "evidence"), { recursive: true });
      await writeFile(
        path.join(directory, "evidence", "legacy.har"),
        JSON.stringify([
          {
            method: "POST",
            url: "https://api.example/API/Checkout?access_token=do-not-persist",
          },
        ]),
        "utf8",
      );
      const resumed = await service.submit({
        runId: started.runId,
        submission: {
          kind: "legacy-network-evidence",
          evidencePath: "evidence/legacy.har",
        },
      });

      expect(resumed.runId).toBe(started.runId);
      expect(resumed.status).toBe("needs-external-action");
      expect(resumed.currentStage).toBe("contracts");
      expect(resumed.nextActions).toEqual([{ kind: "prepare-contracts", runId: started.runId }]);
      expect(resumed.deliveryProfile.legacyNetworkEvidencePath).toBe("evidence/legacy.har");
      expect(resumed.deliveryProfile.openApiOperations).toEqual([
        expect.objectContaining({ operationKey: "POST /API/Checkout" }),
      ]);
      expect(JSON.stringify(await store.get(started.runId))).not.toContain("do-not-persist");
      expect(JSON.stringify(await store.get(started.runId))).not.toContain("password@");
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("does not reuse resolved legacy operations as OpenAPI evidence on same-Run HAR resume", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-api-resume-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      await writeFile(
        path.join(legacyRoot, "src", "shared.ts"),
        [
          'import axios from "axios";',
          'export const known = () => axios.get("/shared");',
          'export const dynamic = () => axios.request({ url: "/shared" });',
          "",
        ].join("\n"),
        "utf8",
      );

      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the legacy API screen",
        mode: "legacy",
        changeKind: "migration",
      });
      expect(started.currentStage).toBe("intake");
      expect(started.deliveryProfile.openApiOperations).toEqual([
        expect.objectContaining({ operationKey: "GET /shared" }),
      ]);

      await mkdir(path.join(directory, "evidence"), { recursive: true });
      await writeFile(
        path.join(directory, "evidence", "unrelated.har"),
        JSON.stringify([{ method: "POST", url: "https://legacy.example/other" }]),
        "utf8",
      );
      const resumed = await service.submit({
        runId: started.runId,
        submission: {
          kind: "legacy-network-evidence",
          evidencePath: "evidence/unrelated.har",
        },
      });

      expect(resumed.runId).toBe(started.runId);
      expect(resumed.currentStage).toBe("intake");
      expect(resumed.nextActions).toEqual([
        {
          kind: "collect-legacy-network-evidence",
          runId: started.runId,
          maxBytes: 1024 * 1024,
          maxRequests: 1_000,
        },
      ]);
      expect(resumed.blockerDetails).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "LEGACY_API_METHOD_UNKNOWN" })]),
      );
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("rejects missing, non-directory, and target-equivalent legacy project roots", async () => {
    await expect(
      service.start({
        projectRoot: directory,
        legacyProjectRoot: path.join(directory, "missing"),
        requestText: "Migrate the legacy screen",
        mode: "legacy",
      }),
    ).rejects.toThrow(/legacy project.*exist/i);

    await expect(
      service.start({
        projectRoot: directory,
        legacyProjectRoot: path.join(directory, "briefs", "checkout.md"),
        requestText: "Migrate the legacy screen",
        mode: "legacy",
      }),
    ).rejects.toThrow(/legacy project.*directory/i);

    await expect(
      service.start({
        projectRoot: directory,
        legacyProjectRoot: directory,
        requestText: "Migrate the legacy screen",
        mode: "legacy",
      }),
    ).rejects.toThrow(/different/i);

    const aliasRoot = path.join(os.tmpdir(), "spec-to-pr-target-alias-" + path.basename(directory));
    await symlink(directory, aliasRoot);
    try {
      await expect(
        service.start({
          projectRoot: directory,
          legacyProjectRoot: aliasRoot,
          requestText: "Migrate the legacy screen",
          mode: "legacy",
        }),
      ).rejects.toThrow(/different/i);
    } finally {
      await rm(aliasRoot, { force: true });
    }

    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("rejects nested legacy/target roots and detects legacy mutation after intake", async () => {
    const nestedLegacy = path.join(directory, "nested-legacy");
    await mkdir(nestedLegacy);
    await expect(
      service.start({
        projectRoot: directory,
        legacyProjectRoot: nestedLegacy,
        requestText: "Migrate the legacy screen",
        mode: "legacy",
      }),
    ).rejects.toThrow(/overlap|separate/i);
    await expect(
      service.start({
        projectRoot: directory,
        legacyProjectRoot: path.dirname(directory),
        requestText: "Migrate the legacy screen",
        mode: "legacy",
      }),
    ).rejects.toThrow(/overlap|separate/i);

    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-fresh-"));
    try {
      await mkdir(path.join(legacyRoot, "src"));
      const legacySource = path.join(legacyRoot, "src", "route.ts");
      await writeFile(legacySource, 'export const route = { path: "/before" };\n', "utf8");
      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the legacy screen",
        mode: "legacy",
      });
      await writeFile(legacySource, 'export const route = { path: "/after" };\n', "utf8");

      await expect(
        service.submit({
          runId: started.runId,
          submission: {
            kind: "contracts",
            status: "passed",
            summary: "Attempted stale contracts.",
            artifactPaths: ["contracts/requirements.json"],
            baselinePaths: [],
            requirementManifest: requirements("legacy-freshness"),
          },
        }),
      ).rejects.toThrow(/LEGACY_SOURCE_CHANGED/);
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("composes feature, brief, Figma, supporting docs, OpenAPI, and guidance sources", async () => {
    await mkdir(path.join(directory, "docs", "architecture"), { recursive: true });
    await writeFile(
      path.join(directory, "docs", "business-rules.md"),
      "The checkout screen must show a concise payment error.\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, "docs", "openapi.yaml"),
      "openapi: 3.1.0\npaths:\n  /checkout:\n    post:\n      operationId: checkout\n      responses: {}\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, "docs", "architecture", "ARCHITECTURE.md"),
      "Place feature code in the checkout slice.\n",
      "utf8",
    );

    const status = await service.start({
      projectRoot: directory,
      requestText: "Implement checkout from the supplied sources",
      scope: "auto",
      mode: "feature",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
      docsPath: "docs/business-rules.md",
      docsPaths: ["docs/business-rules.md"],
      openApiPath: "docs/openapi.yaml",
      guidancePaths: ["docs/architecture/ARCHITECTURE.md"],
      skillHints: ["react-best-practices", "api-generator"],
    });

    expect(status.deliveryProfile).toMatchObject({
      mode: "feature",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      docsPaths: ["docs/business-rules.md"],
      openApiPaths: ["docs/openapi.yaml"],
      guidancePaths: ["docs/architecture/ARCHITECTURE.md"],
      discoveredGuidancePaths: [],
      skillHints: ["react-best-practices", "api-generator"],
      requirements: {
        brief: true,
        targetedFeatureE2E: true,
        featureVideo: true,
        figmaBundle: true,
      },
    });
    expect(status.scope).toMatchObject({ ui: true, api: true, specification: true });

    const stored = await store.get(status.runId);
    const labels = stored.sources.flatMap((source) =>
      source.locator.type === "inline" ? [source.locator.label] : [],
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "brief:briefs/checkout.md",
        "docs:docs/business-rules.md",
        "openapi:docs/openapi.yaml",
        "guidance:docs/architecture/ARCHITECTURE.md",
      ]),
    );
    expect(labels.filter((label) => label === "docs:docs/business-rules.md")).toHaveLength(1);
  });

  it("discovers only fixed project guidance without activating unrelated gates", async () => {
    await mkdir(path.join(directory, "docs", "etc"), { recursive: true });
    await writeFile(
      path.join(directory, "AGENTS.md"),
      "React UI API auth performance telemetry rules apply when relevant.\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, "docs", "etc", "folder-structure.md"),
      "Keep source files grouped by feature.\n",
      "utf8",
    );
    await writeFile(path.join(directory, "docs", "not-discovered.md"), "Ignore me.\n", "utf8");

    const started = await service.start({
      projectRoot: directory,
      requestText: "Update one sentence in the release notes",
      scope: "docs",
      mode: "auto",
      changeKind: "docs",
      publication: "none",
      skillHints: ["next-best-practices"],
    });

    expect(started.deliveryProfile).toMatchObject({
      guidancePaths: [],
      discoveredGuidancePaths: ["AGENTS.md", "docs/etc/folder-structure.md"],
      skillHints: ["next-best-practices"],
    });
    expect(started.scope).toMatchObject({
      code: false,
      ui: false,
      api: false,
      securitySensitive: false,
      performanceSensitive: false,
      observabilityRequested: false,
    });
    for (const validation of ["accessibility", "api-ready", "security", "performance"]) {
      expect(started.requiredValidations).not.toContain(validation);
    }

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Release-note contract ready.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("release-notes"),
        },
      }),
    ).rejects.toThrow(/guidance/i);

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Release-note contract follows project guidance.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("release-notes"),
          guidanceTrace: {
            explicit: [],
            discovered: ["AGENTS.md", "docs/etc/folder-structure.md"],
            skillHints: ["next-best-practices"],
          },
        },
      }),
    ).resolves.toMatchObject({ nextActions: [{ kind: "implement" }] });
  });

  it("allows applied skill hints to be a subset but rejects unrequested hints", async () => {
    const optional = await service.start({
      projectRoot: directory,
      requestText: "Update the release notes",
      scope: "docs",
      publication: "none",
      skillHints: ["react-best-practices", "not-installed"],
    });

    await expect(
      service.submit({
        runId: optional.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Applied only the available and relevant skill.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("optional-skills"),
          guidanceTrace: {
            explicit: [],
            discovered: [],
            skillHints: ["react-best-practices"],
            appliedSkills: ["react-best-practices"],
          },
        },
      }),
    ).resolves.toMatchObject({ nextActions: [{ kind: "implement" }] });

    const unrequested = await service.start({
      projectRoot: directory,
      requestText: "Update another release note",
      scope: "docs",
      publication: "none",
      skillHints: ["react-best-practices"],
    });
    await expect(
      service.submit({
        runId: unrequested.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Claimed an unrequested skill.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("unrequested-skills"),
          guidanceTrace: {
            explicit: [],
            discovered: [],
            skillHints: ["api-generator"],
            appliedSkills: ["api-generator"],
          },
        },
      }),
    ).rejects.toThrow(/applied skill|skill hint.*requested/i);

    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(
      path.join(directory, "docs", "recommended-openapi.yaml"),
      "openapi: 3.1.0\npaths:\n  /health:\n    get:\n      responses: {}\n",
      "utf8",
    );
    const recommended = await service.start({
      projectRoot: directory,
      requestText: "Prepare the supplied API contract",
      scope: "non-ui",
      publication: "none",
      openApiPaths: ["docs/recommended-openapi.yaml"],
    });
    await expect(
      service.submit({
        runId: recommended.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Applied the recommended API generation workflow.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("recommended-skills"),
          guidanceTrace: {
            explicit: [],
            discovered: [],
            skillHints: [],
            appliedSkills: ["api-generator"],
          },
        },
      }),
    ).resolves.toMatchObject({ nextActions: [{ kind: "implement" }] });
  });

  it("blocks missing explicit guidance before creating a durable Run", async () => {
    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Refactor the parser",
        guidancePaths: ["docs/missing-guidance.md"],
      }),
    ).rejects.toThrow(/Guidance file does not exist/i);
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("deduplicates same-role symlink aliases to one canonical source", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(path.join(directory, "docs", "canonical.md"), "Canonical rules.\n", "utf8");
    await symlink("canonical.md", path.join(directory, "docs", "alias-a.md"));
    await symlink("canonical.md", path.join(directory, "docs", "alias-b.md"));

    const started = await service.start({
      projectRoot: directory,
      requestText: "Use the supporting rules",
      docsPaths: ["docs/alias-a.md", "docs/alias-b.md"],
    });
    expect(started.deliveryProfile.docsPaths).toEqual(["docs/canonical.md"]);
    const run = await store.get(started.runId);
    expect(
      run.sources.filter(
        (source) =>
          source.locator.type === "inline" && source.locator.label === "docs:docs/canonical.md",
      ),
    ).toHaveLength(1);
  });

  it("detects canonical cross-role conflicts before reading content", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(path.join(directory, "docs", "canonical.txt"), " ".repeat(10), "utf8");
    await symlink("canonical.txt", path.join(directory, "docs", "as-docs.txt"));
    await symlink("canonical.txt", path.join(directory, "docs", "as-openapi.txt"));

    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Use the supplied sources",
        docsPaths: ["docs/as-docs.txt"],
        openApiPaths: ["docs/as-openapi.txt"],
      }),
    ).rejects.toThrow(/both supporting documentation and OpenAPI/i);
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("rejects a source alias whose canonical target is outside the project root", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-outside-"));
    try {
      await writeFile(path.join(outside, "rules.md"), "Outside rules.\n", "utf8");
      await mkdir(path.join(directory, "docs"), { recursive: true });
      await symlink(path.join(outside, "rules.md"), path.join(directory, "docs", "outside.md"));

      await expect(
        service.start({
          projectRoot: directory,
          requestText: "Use the aliased document",
          docsPaths: ["docs/outside.md"],
        }),
      ).rejects.toThrow(/project root/i);
      await expect(store.list()).resolves.toHaveLength(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("preserves the 1 MB text-source boundary for composable files", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(path.join(directory, "docs", "large.md"), "a".repeat(300_000), "utf8");

    const accepted = await service.start({
      projectRoot: directory,
      requestText: "Use the supplied supporting document",
      docsPaths: ["docs/large.md"],
    });
    expect(accepted.deliveryProfile.docsPaths).toEqual(["docs/large.md"]);

    await writeFile(
      path.join(directory, "docs", "too-large.md"),
      "a".repeat(1024 * 1024 + 1),
      "utf8",
    );
    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Use the oversized document",
        docsPaths: ["docs/too-large.md"],
      }),
    ).rejects.toThrow(/1 MB limit/i);
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("builds parser-safe chunks for long internal whitespace spans", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(
      path.join(directory, "docs", "whitespace-span.md"),
      `${"x".repeat(190_000)}${" ".repeat(190_000)}`,
      "utf8",
    );

    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Use the supplied long document",
        docsPaths: ["docs/whitespace-span.md"],
      }),
    ).resolves.toMatchObject({
      deliveryProfile: { docsPaths: ["docs/whitespace-span.md"] },
    });
  });

  it("rejects invalid chunk plans before creating a durable Run", async () => {
    await mkdir(path.join(directory, "docs"), { recursive: true });
    await writeFile(path.join(directory, "docs", "blank.md"), " ".repeat(300_000), "utf8");

    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Use the blank document",
        docsPaths: ["docs/blank.md"],
      }),
    ).rejects.toThrow(/non-whitespace|parser-safe/i);
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("defaults older v2 Runs without delivery profiles to the lightweight auto profile", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser",
      scope: "non-ui",
    });
    const run = await store.get(started.runId);
    await store.save(
      {
        ...run,
        revision: run.revision + 1,
        stages: run.stages.map((item) =>
          item.name === "intake" && item.checkpoint !== undefined
            ? {
                ...item,
                checkpoint: {
                  ...item.checkpoint,
                  data: {
                    scope: item.checkpoint.data["scope"],
                    gatePlan: item.checkpoint.data["gatePlan"],
                  },
                },
              }
            : item,
        ),
      },
      run.revision,
    );

    await expect(service.status({ runId: started.runId })).resolves.toMatchObject({
      deliveryProfile: { mode: "auto", publication: "draft" },
    });
  });

  it("rejects invalid mode inputs before creating a durable Run", async () => {
    await expect(
      service.start({
        projectRoot: directory,
        requestText: "Implement this design",
        scope: "docs",
        mode: "figma",
        changeKind: "design",
      }),
    ).rejects.toThrow();
    await expect(store.list()).resolves.toHaveLength(0);
  });

  it("resumes a v0.3.1 local-only legacy Run without requiring stale draft artifacts", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-local-"));
    try {
      await mkdir(path.join(legacyRoot, "src"), { recursive: true });
      await writeFile(
        path.join(legacyRoot, "src", "shop.ts"),
        'export const shopRoute = { path: "/shop" };\n',
        "utf8",
      );
      const started = await service.start({
        projectRoot: directory,
        legacyProjectRoot: legacyRoot,
        requestText: "Migrate the local Shop screen without publication",
        mode: "legacy",
        changeKind: "migration",
        publication: "none",
      });
      const legacyFeatureKey = started.legacyInventory?.entries[0]?.featureKey;
      if (legacyFeatureKey === undefined) throw new Error("Missing runtime legacy inventory");

      const run = await store.get(started.runId);
      const staleDraftEvidenceBundle = createDraftEvidenceBundle({
        mode: "legacy",
        legacyProjectRoot: legacyRoot,
      });
      await store.save(
        {
          ...run,
          revision: run.revision + 1,
          updatedAt: new Date(Date.parse(run.updatedAt) + 1_000).toISOString(),
          stages: run.stages.map((item) => {
            if (item.name !== "intake" || item.checkpoint === undefined) return item;
            const deliveryProfile = item.checkpoint.data["deliveryProfile"];
            if (
              typeof deliveryProfile !== "object" ||
              deliveryProfile === null ||
              Array.isArray(deliveryProfile)
            ) {
              throw new Error("Missing persisted delivery profile");
            }
            return {
              ...item,
              checkpoint: {
                ...item.checkpoint,
                data: {
                  ...item.checkpoint.data,
                  deliveryProfile: {
                    ...deliveryProfile,
                    draftEvidenceBundle: staleDraftEvidenceBundle,
                  },
                },
              },
            };
          }),
        },
        run.revision,
      );

      const resumed = await service.status({ runId: started.runId });
      expect(resumed.deliveryProfile.publication).toBe("none");
      expect(resumed.deliveryProfile.draftEvidenceBundle).toBeUndefined();

      const accepted = await service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Captured the local-only Shop migration contract.",
          artifactPaths: [
            "contracts/requirements.json",
            "contracts/legacy-baseline.md",
            "visual/legacy.png",
          ],
          baselinePaths: ["contracts/legacy-baseline.md", "visual/legacy.png"],
          requirementManifest: requirements("legacy-local-shop"),
          legacyScopeKeys: [legacyFeatureKey],
          legacyCoverage: [
            {
              featureKey: legacyFeatureKey,
              requirementIds: ["legacy-local-shop"],
              status: "planned",
              targetFiles: [],
              executableEvidencePaths: [],
              rationale: "The persisted local-only Run keeps its selected Shop feature.",
            },
          ],
          visualTargets: [
            {
              targetId: "legacy-local-shop",
              name: "Legacy local Shop",
              state: "default",
              route: "/shop",
              baselineKind: "legacy-screenshot",
              baselinePath: "visual/legacy.png",
              viewport: { width: 1, height: 1 },
              deviceScaleFactor: 1,
              fixture: "legacy:local-shop",
              masks: [],
            },
          ],
          legacyBaseline: {
            scope: "local Shop route",
            evidencePaths: ["contracts/legacy-baseline.md"],
            checks: [
              {
                command: "pnpm test -- shop",
                resultPath: "contracts/legacy-baseline.md",
                status: "passed",
              },
            ],
          },
        },
      });

      expect(accepted.nextActions.map((action) => action.kind)).toContain("implement");
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("blocks legacy contracts without a focused baseline", async () => {
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-contract-"));
    await mkdir(path.join(legacyRoot, "src"), { recursive: true });
    const legacySourcePath = path.join(legacyRoot, "src", "parser.ts");
    const legacySource = 'export const parserRoute = { path: "/parser" };\n';
    await writeFile(legacySourcePath, legacySource, "utf8");
    await writeFile(
      path.join(directory, "test-results", "unit.json"),
      JSON.stringify({ status: "passed" }),
      "utf8",
    );
    const started = await service.start({
      projectRoot: directory,
      legacyProjectRoot: legacyRoot,
      requestText: "Migrate parsing behavior from the legacy project",
      mode: "legacy",
      changeKind: "migration",
      publication: "draft",
    });
    expect(started.revision).toBeGreaterThan(0);
    const legacyFeatureKey = started.legacyInventory?.entries[0]?.featureKey;
    if (legacyFeatureKey === undefined) throw new Error("Missing runtime legacy inventory");

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Captured the requested delta only.",
          artifactPaths: ["contracts/requirements.json"],
          baselinePaths: [],
          requirementManifest: requirements("legacy-fix"),
        },
      }),
    ).rejects.toThrow(/baseline/i);

    const draftEvidenceBundle = started.deliveryProfile.draftEvidenceBundle;
    if (draftEvidenceBundle === undefined) throw new Error("Missing draft evidence bundle profile");
    await mkdir(path.dirname(path.join(directory, draftEvidenceBundle.manifestPath)), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, draftEvidenceBundle.manifestPath),
      JSON.stringify({ placeholder: true }),
      "utf8",
    );
    const contractSubmission = {
      kind: "contracts",
      status: "passed",
      summary: "Captured current behavior and the requested delta.",
      artifactPaths: [
        "contracts/requirements.json",
        "contracts/legacy-baseline.md",
        "visual/legacy.png",
        "test-results/unit.json",
        draftEvidenceBundle.manifestPath,
        "openspec/changes/migrate-shop-vue3/proposal.md",
        "openspec/changes/migrate-shop-vue3/specs/shop-migration/spec.md",
        "openspec/changes/migrate-shop-vue3/tasks.md",
      ],
      baselinePaths: ["contracts/legacy-baseline.md", "visual/legacy.png"],
      requirementManifest: requirements("legacy-fix"),
      legacyScopeKeys: [legacyFeatureKey],
      legacyCoverage: [
        {
          featureKey: legacyFeatureKey,
          requirementIds: ["legacy-fix"],
          status: "planned",
          targetFiles: [],
          executableEvidencePaths: [],
          rationale: "The parser route is explicitly planned for migration.",
        },
      ],
      visualTargets: [
        {
          targetId: "legacy-parser",
          name: "Legacy parser",
          state: "default",
          route: "/parser",
          baselineKind: "legacy-screenshot",
          baselinePath: "visual/legacy.png",
          viewport: { width: 1, height: 1 },
          deviceScaleFactor: 1,
          fixture: "legacy:parser-default",
          masks: [],
        },
      ],
      legacyBaseline: {
        scope: "parser behavior changed by this fix",
        evidencePaths: ["contracts/legacy-baseline.md"],
        checks: [
          {
            command: "pnpm test -- parser",
            resultPath: "contracts/legacy-baseline.md",
            status: "passed",
          },
        ],
      },
      draftBundle: {
        manifestPath: draftEvidenceBundle.manifestPath,
        changeName: "migrate-shop-vue3",
        proposalPath: "openspec/changes/migrate-shop-vue3/proposal.md",
        specPaths: ["openspec/changes/migrate-shop-vue3/specs/shop-migration/spec.md"],
        tasksPath: "openspec/changes/migrate-shop-vue3/tasks.md",
      },
    } as const;
    await expect(
      service.submit({
        runId: started.runId,
        submission: { ...contractSubmission, draftBundle: undefined },
      }),
    ).rejects.toThrow(/Draft bundle/i);
    const wrongManifestPath = ".spec-to-pr/other/manifest.json";
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          ...contractSubmission,
          artifactPaths: contractSubmission.artifactPaths.map((artifactPath) =>
            artifactPath === draftEvidenceBundle.manifestPath ? wrongManifestPath : artifactPath,
          ),
          draftBundle: { ...contractSubmission.draftBundle, manifestPath: wrongManifestPath },
        },
      }),
    ).rejects.toThrow(/manifest.*delivery profile/i);

    await expect(
      service.submit({ runId: started.runId, submission: contractSubmission }),
    ).rejects.toThrow(/manifest.*schema/i);
    const openSpecArtifact = (artifactPath: string) => ({
      path: artifactPath,
      digest: `sha256:${createHash("sha256").update(`${artifactPath}\n`).digest("hex")}`,
    });
    const draftManifest = {
      schemaVersion: "draft-evidence-manifest-v1",
      runId: started.runId,
      runRevision: started.revision,
      phase: "pre-implementation",
      legacyRootDigest: started.legacyInventory?.rootDigest,
      requirementIds: ["legacy-fix"],
      openSpec: {
        changeName: contractSubmission.draftBundle.changeName,
        proposal: openSpecArtifact(contractSubmission.draftBundle.proposalPath),
        specs: contractSubmission.draftBundle.specPaths.map(openSpecArtifact),
        tasks: openSpecArtifact(contractSubmission.draftBundle.tasksPath),
      },
    } as const;
    await writeFile(
      path.join(directory, draftEvidenceBundle.manifestPath),
      JSON.stringify(draftManifest),
      "utf8",
    );
    await writeFile(
      path.join(directory, contractSubmission.draftBundle.proposalPath),
      "stale proposal\n",
      "utf8",
    );
    await expect(
      service.submit({ runId: started.runId, submission: contractSubmission }),
    ).rejects.toThrow(/OpenSpec digest does not match/i);
    await writeFile(
      path.join(directory, contractSubmission.draftBundle.proposalPath),
      `${contractSubmission.draftBundle.proposalPath}\n`,
      "utf8",
    );

    const accepted = await service.submit({
      runId: started.runId,
      submission: contractSubmission,
    });

    expect(accepted.nextActions[0]?.kind).toBe("implement");
    const contractRun = await store.get(started.runId);
    expect(
      contractRun.artifacts.some(
        (artifact) =>
          artifact.kind === "openspec" && artifact.metadata["changeName"] === "migrate-shop-vue3",
      ),
    ).toBe(true);
    await writeFile(legacySourcePath, 'export const parserRoute = { path: "/changed" };\n');
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Attempted implementation against a changed legacy source.",
          apiReady: false,
          uiChanged: true,
          changedFiles: [
            draftEvidenceBundle.manifestPath,
            "src/parser.ts",
            "test-results/unit.json",
          ],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow(/LEGACY_SOURCE_CHANGED/);
    await writeFile(legacySourcePath, legacySource, "utf8");
    await changeSource(directory, "src/parser.ts", "export const parser = 'migrated';\n");
    const performanceEvidence = {
      lab: {
        route: "/parser",
        tool: "Lighthouse",
        command: "pnpm lighthouse /parser",
        deviceProfile: "mobile",
        throttling: "simulated-4g",
        sampleCount: 3,
        resultPath: "test-results/performance.json",
        metrics: { lcpMs: 2_100, cls: 0.04, tbtMs: 120 },
      },
      field: { status: "unavailable", reason: "No production field source." },
    } as const;
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Migration claimed without current coverage.",
          apiReady: false,
          uiChanged: true,
          changedFiles: [
            draftEvidenceBundle.manifestPath,
            "src/parser.ts",
            "test-results/unit.json",
          ],
          artifactPaths: ["test-results/unit.json", "test-results/performance.json"],
          performanceEvidence,
        },
      }),
    ).rejects.toThrow(/legacy coverage/i);
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Parser migration implemented and verified.",
        apiReady: false,
        uiChanged: true,
        changedFiles: [draftEvidenceBundle.manifestPath, "src/parser.ts", "test-results/unit.json"],
        artifactPaths: ["test-results/unit.json", "test-results/performance.json"],
        legacyCoverage: [
          {
            featureKey: legacyFeatureKey,
            requirementIds: ["legacy-fix"],
            status: "migrated",
            targetFiles: ["src/parser.ts"],
            executableEvidencePaths: ["test-results/unit.json"],
            rationale:
              "Current packet contains the migrated route and passing regression evidence.",
          },
        ],
        performanceEvidence,
      },
    });
    expect(implemented.nextActions.map((action) => action.kind)).toContain("compare-visuals");
    await rm(legacyRoot, { recursive: true, force: true });
  });

  it("blocks Figma contracts until a real bundle is submitted", async () => {
    const figmaUrl = FIGMA_URL;
    const started = await service.start({
      projectRoot: directory,
      requestText: `Implement ${figmaUrl}`,
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl,
    });
    expect(started.deliveryProfile.publication).toBe("draft");

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Mapped design requirements.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: requirements("figma-screen"),
        },
      }),
    ).rejects.toThrow(/Figma bundle/i);

    const bundled = await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: figmaUrl,
        fileUrls: [figmaUrl],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });
    expect(bundled.resumeContext.submissions).toContainEqual({
      kind: "figma-bundle",
      summary: "Accepted host-connected Figma bundle.",
      outcome: "passed",
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "figma-bundle",
          provider: "host-connected-figma",
          capturedAt: "2026-07-13T00:00:00.000Z",
          fileUrl: figmaUrl,
          fileUrls: [figmaUrl],
          nodeIds: ["1:2"],
          capturedComponents: figmaCapturedComponents(),
          designMapping: figmaDesignMapping(),
          manifestPath: "figma/design-context.json",
          stateContracts: figmaStateContracts(),
          visualTargets: figmaVisualTargets(),
          artifactPaths: ["figma/design-context.json", "visual/diff.png"],
        },
      }),
    ).rejects.toThrow(/already/i);

    const accepted = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Mapped real design evidence.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("figma-screen"),
      },
    });
    expect(accepted.nextActions[0]?.kind).toBe("implement");
  });

  it("binds captured Figma components and named fixtures to implementation evidence", async () => {
    const capturedComponents = [{ name: "Logo/Normal/nxplus_park", nodeId: "1:2" }];
    const logoBytes = Buffer.from("canonical nxplus park webp fixture", "utf8");
    await mkdir(path.join(directory, "assets"), { recursive: true });
    await writeFile(path.join(directory, "assets/nxplus_park.webp"), logoBytes);
    await execFileAsync("git", ["add", "assets/nxplus_park.webp"], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "add canonical logo asset"], { cwd: directory });
    const designMapping = {
      designSystem: {
        packageName: "@frontend/ui",
        packageVersion: "1.2.3",
        guidanceSkill: "design-system",
      },
      components: [
        {
          figmaComponent: "Logo/Normal/nxplus_park",
          nodeId: "1:2",
          resolution: {
            kind: "asset" as const,
            path: "assets/nxplus_park.webp",
            digest: `sha256:${createHash("sha256").update(logoBytes).digest("hex")}`,
          },
        },
      ],
      fonts: [],
      tokens: [],
    };
    await writeFile(
      path.join(directory, "figma/design-context.json"),
      JSON.stringify({
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents,
        designMapping,
        visualPaths: ["visual/diff.png"],
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
      }),
      "utf8",
    );
    await execFileAsync("git", ["add", "figma/design-context.json"], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "bind Figma design mapping"], {
      cwd: directory,
    });
    const started = await service.start({
      projectRoot: directory,
      requestText: `Implement ${FIGMA_URL} with the internal design system`,
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl: FIGMA_URL,
    });
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "figma-bundle",
          provider: "host-connected-figma",
          capturedAt: "2026-07-13T00:00:00.000Z",
          fileUrl: FIGMA_URL,
          fileUrls: [FIGMA_URL],
          nodeIds: ["1:2"],
          capturedComponents,
          designMapping: {
            ...designMapping,
            components: [
              {
                ...designMapping.components[0]!,
                resolution: {
                  ...designMapping.components[0]!.resolution,
                  digest: `sha256:${"0".repeat(64)}`,
                },
              },
            ],
          },
          manifestPath: "figma/design-context.json",
          stateContracts: figmaStateContracts(),
          visualTargets: figmaVisualTargets(),
          artifactPaths: ["figma/design-context.json", "visual/diff.png"],
        },
      }),
    ).rejects.toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE.*asset digest/);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents,
        designMapping,
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Bound the internal logo component and deterministic state.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("figma-screen"),
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'mapped';\n");
    const implementation = {
      kind: "implementation",
      status: "passed",
      summary: "Implemented the mapped Figma component.",
      apiReady: false,
      uiChanged: true,
      changedFiles: ["src/checkout.tsx"],
      artifactPaths: ["test-results/unit.json", "mocks/manifest.json", "mocks/checkout.json"],
      mockDataEvidence: {
        manifestPath: "mocks/manifest.json",
        fixtures: [
          {
            id: "mock:checkout",
            path: "mocks/checkout.json",
            stateContractDigest: figmaStateContracts()[0]!.digest,
          },
        ],
      },
    } as const;

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          ...implementation,
          mockDataEvidence: {
            manifestPath: "mocks/manifest.json",
            fixtures: [
              {
                id: "mock:checkout",
                path: "mocks/checkout.json",
                stateContractDigest: `sha256:${"0".repeat(64)}`,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/FIGMA_STATE_CONTRACT_INVALID.*digest/i);
    await expect(
      service.submit({ runId: started.runId, submission: implementation }),
    ).rejects.toThrow(/FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID.*Logo\/Normal\/nxplus_park/);
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          ...implementation,
          designSystemEvidence: {
            usages: [
              {
                figmaComponent: "Logo/Normal/nxplus_park",
                sourceFile: "src/checkout.tsx",
                resolutionKind: "asset",
                assetPath: "assets/wrong.webp",
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID.*mismatched/);
    const accepted = await service.submit({
      runId: started.runId,
      submission: {
        ...implementation,
        designSystemEvidence: {
          usages: [
            {
              figmaComponent: "Logo/Normal/nxplus_park",
              sourceFile: "src/checkout.tsx",
              resolutionKind: "asset",
              assetPath: "assets/nxplus_park.webp",
            },
          ],
        },
      },
    });
    expect(accepted.nextActions.map((action) => action.kind)).toContain("compare-visuals");
  });

  it("requires a targeted feature E2E and exactly one video only in feature mode", async () => {
    const markdownBearingGuidancePath =
      "docs/rules\n## Injected heading\n<!-- injected-comment --> [label](target).md";
    await mkdir(path.join(directory, "docs/architecture"), { recursive: true });
    await writeFile(path.join(directory, "AGENTS.md"), "Use project-local conventions.\n", "utf8");
    await writeFile(
      path.join(directory, "docs/architecture/ARCHITECTURE.md"),
      "Keep checkout API and UI in one implementation context.\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, markdownBearingGuidancePath),
      "Treat this unusual filename as inert report data.\n",
      "utf8",
    );
    await execFileAsync(
      "git",
      ["add", "AGENTS.md", "docs/architecture/ARCHITECTURE.md", markdownBearingGuidancePath],
      { cwd: directory },
    );
    await execFileAsync("git", ["commit", "-qm", "add project guidance"], { cwd: directory });
    const started = await service.start({
      projectRoot: directory,
      requestText: "Add the user-facing checkout feature",
      scope: "ui",
      mode: "feature",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
      figmaUrl: FIGMA_URL,
      openApiPaths: ["docs/openapi.yaml"],
      guidancePaths: ["docs/architecture/ARCHITECTURE.md", markdownBearingGuidancePath],
      skillHints: ["react-best-practices", "api-generator", "not-installed"],
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Feature contracts ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout-feature"),
        guidanceTrace: {
          explicit: ["docs/architecture/ARCHITECTURE.md", markdownBearingGuidancePath],
          discovered: ["AGENTS.md"],
          skillHints: ["react-best-practices", "api-generator"],
          appliedSkills: ["react-best-practices", "api-generator"],
        },
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "api-ready",
        status: "passed",
        summary: "Checkout API artifacts and contract test are ready.",
        implementationContextId: FEATURE_CONTEXT_ID,
        artifactPaths: [
          "generated/api.ts",
          "generated/schema.ts",
          "generated/wrapper.ts",
          "generated/mock.ts",
          "test-results/api-contract.json",
        ],
        apiArtifacts: {
          types: ["generated/api.ts"],
          schemas: ["generated/schema.ts"],
          wrappers: ["generated/wrapper.ts"],
          mocks: ["generated/mock.ts"],
          contractTests: ["test-results/api-contract.json"],
        },
        operations: checkoutApiReadyOperations(),
      },
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Feature implemented without targeted evidence.",
          apiReady: true,
          implementationContextId: FEATURE_CONTEXT_ID,
          uiChanged: true,
          changedFiles: ["src/checkout.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow(/targeted feature E2E/i);

    const featureSubmission = {
      kind: "implementation",
      status: "passed",
      summary: "Feature implemented with one targeted E2E recording.",
      apiReady: true,
      uiChanged: true,
      changedFiles: ["src/checkout.tsx"],
      artifactPaths: [
        "test-results/contract.json",
        "test-results/checkout.json",
        "test-results/checkout.mp4",
        "test-results/api-coverage.json",
        "test-results/performance.json",
        "mocks/manifest.json",
        "mocks/checkout.json",
      ],
      implementationContextId: FEATURE_CONTEXT_ID,
      featureEvidence: {
        scope: "targeted-feature",
        testSelector: "e2e/checkout.spec.ts",
        testCommand: "playwright test e2e/checkout.spec.ts",
        resultPath: "test-results/checkout.json",
        videoPath: "test-results/checkout.mp4",
      },
      apiCoverage: [
        {
          operationKey: "POST /checkout",
          method: "POST",
          path: "/checkout",
          operationId: "checkout",
          status: "exercised",
          productionCallSites: ["src/checkout.tsx#submitCheckout"],
          mockHandlers: ["generated/mock.ts#checkout"],
          executableEvidencePaths: ["test-results/api-coverage.json"],
          blocking: false,
        },
      ],
      performanceEvidence: {
        lab: {
          route: "/checkout",
          tool: "Lighthouse",
          command: "pnpm lighthouse /checkout",
          deviceProfile: "mobile",
          throttling: "simulated-4g",
          sampleCount: 3,
          resultPath: "test-results/performance.json",
          metrics: { lcpMs: 2_100, cls: 0.04, tbtMs: 120 },
        },
        field: {
          status: "unavailable",
          reason: "No existing CrUX or authorized RUM source.",
        },
      },
      mockDataEvidence: {
        manifestPath: "mocks/manifest.json",
        fixtures: [
          {
            id: "mock:checkout",
            path: "mocks/checkout.json",
            stateContractDigest: figmaStateContracts()[0]!.digest,
          },
        ],
      },
    } as const;

    await writeFile(
      path.join(directory, "test-results/checkout.json"),
      JSON.stringify({ status: "failed" }),
      "utf8",
    );
    await expect(
      service.submit({ runId: started.runId, submission: featureSubmission }),
    ).rejects.toThrow(/Feature result/i);
    await writeFile(
      path.join(directory, "test-results/checkout.json"),
      JSON.stringify({
        status: "passed",
        selector: "e2e/checkout.spec.ts",
        implementationContextId: FEATURE_CONTEXT_ID,
        testCount: 0,
      }),
      "utf8",
    );
    await expect(
      service.submit({ runId: started.runId, submission: featureSubmission }),
    ).rejects.toThrow(/Feature result/i);
    await writeFile(
      path.join(directory, "test-results/checkout.json"),
      JSON.stringify({
        status: "passed",
        selector: "e2e/checkout.spec.ts",
        implementationContextId: FEATURE_CONTEXT_ID,
        testCount: 1,
      }),
      "utf8",
    );
    await writeFile(path.join(directory, "test-results/checkout.mp4"), "not a video", "utf8");
    await expect(
      service.submit({ runId: started.runId, submission: featureSubmission }),
    ).rejects.toThrow(/WebM or MP4/i);
    await writeFile(path.join(directory, "test-results/checkout.mp4"), validMp4());

    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'feature';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: featureSubmission,
    });

    expect(implemented.nextActions.map((action) => action.kind).sort()).toEqual([
      "compare-visuals",
      "review-functional",
    ]);
    const visualAction = implemented.nextActions.find(
      (action) => action.kind === "compare-visuals",
    );
    if (visualAction === undefined || !("reviewPacketId" in visualAction)) {
      throw new Error("Missing visual comparison action");
    }
    const featureActualPath = `visual/actual/${visualAction.reviewPacketId}/checkout.png`;
    await mkdir(path.dirname(path.join(directory, featureActualPath)), { recursive: true });
    const featureActualBytes = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    await writeFile(path.join(directory, featureActualPath), featureActualBytes);
    const featureRun = await store.get(started.runId);
    const featureImplementationArtifact = [...featureRun.artifacts]
      .reverse()
      .find(
        (artifact) =>
          artifact.kind === "agent-result-report" &&
          artifact.metadata["workflowSubmissionKind"] === "implementation",
      );
    const featurePacket = featureImplementationArtifact?.metadata["reviewPacket"] as
      { headSha?: unknown } | undefined;
    if (typeof featurePacket?.headSha !== "string") {
      throw new Error("Missing feature implementation packet head");
    }
    const featureActualDigest =
      `sha256:${createHash("sha256").update(featureActualBytes).digest("hex")}` as const;
    const featureReceiptPath =
      `visual/actual/${visualAction.reviewPacketId}/checkout.json` as const;
    const featureReceiptBytes = Buffer.from(
      JSON.stringify({
        reviewPacketId: visualAction.reviewPacketId,
        headSha: featurePacket.headSha,
        targetId: "checkout-default",
        route: "/checkout",
        state: "default",
        captureKind: "viewport",
        logicalSize: { width: 1, height: 1 },
        deviceScaleFactor: 1,
        playwrightVersion: "1.54.1",
        browserName: "chromium",
        browserVersion: "138.0.7204.168",
        locale: "ko-KR",
        colorScheme: "light",
        timezone: "Asia/Seoul",
        userAgent: "Mozilla/5.0 Chromium",
        fonts: [],
        fixture: {
          id: "mock:checkout",
          digest: `sha256:${createHash("sha256")
            .update(Buffer.from(JSON.stringify({ state: "checkout" }), "utf8"))
            .digest("hex")}`,
        },
        assets: [],
        assetsComplete: true,
        actual: {
          path: featureActualPath,
          digest: featureActualDigest,
          bitmapSize: { width: 1, height: 1 },
        },
        runnerVersion: "capture-runner-v1",
        normalizerVersion: "visual-normalizer-v1",
        capturedAt: "2026-07-20T00:00:00.000Z",
      }),
      "utf8",
    );
    await writeFile(path.join(directory, featureReceiptPath), featureReceiptBytes);
    const featureCapture = {
      targetId: "checkout-default",
      route: "/checkout",
      state: "default",
      viewport: { width: 1, height: 1 },
      deviceScaleFactor: 1,
      fixture: "mock:checkout",
      provider: "playwright",
      capturedAt: "2026-07-20T00:00:00.000Z",
      actualPath: featureActualPath,
      actualDigest: featureActualDigest,
      receiptPath: featureReceiptPath,
      receiptDigest:
        `sha256:${createHash("sha256").update(featureReceiptBytes).digest("hex")}` as const,
    };
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "visual-comparison",
          reviewPacketId: visualAction.reviewPacketId,
          captures: [{ ...featureCapture, route: "/wrong" }],
          artifactPaths: [featureActualPath, featureReceiptPath],
        },
      }),
    ).rejects.toThrow(/capture manifest.*target/i);
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "visual-comparison",
          reviewPacketId: visualAction.reviewPacketId,
          captures: [{ ...featureCapture, actualDigest: `sha256:${"0".repeat(64)}` }],
          artifactPaths: [featureActualPath, featureReceiptPath],
        },
      }),
    ).rejects.toThrow(/VISUAL_CAPTURE_DIGEST_MISMATCH/);
    const visuallyCompared = await service.submit({
      runId: started.runId,
      submission: {
        kind: "visual-comparison",
        reviewPacketId: visualAction.reviewPacketId,
        captures: [featureCapture],
        artifactPaths: [featureActualPath, featureReceiptPath],
      },
    });
    expect(visuallyCompared.nextActions.map((action) => action.kind).sort()).toEqual([
      "review-design",
      "review-functional",
    ]);
    const beforePassingReplay = await store.get(started.runId);
    const passingReportCount = beforePassingReplay.artifacts.filter(
      (artifact) => artifact.kind === "visual-report",
    ).length;
    const passingReplay = await service.submit({
      runId: started.runId,
      submission: {
        kind: "visual-comparison",
        reviewPacketId: visualAction.reviewPacketId,
        captures: [featureCapture],
        artifactPaths: [featureActualPath, featureReceiptPath],
      },
    });
    const afterPassingReplay = await store.get(started.runId);
    expect(passingReplay.revision).toBe(beforePassingReplay.revision);
    expect(afterPassingReplay.revision).toBe(beforePassingReplay.revision);
    expect(
      afterPassingReplay.artifacts.filter((artifact) => artifact.kind === "visual-report"),
    ).toHaveLength(passingReportCount);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        reviewPacketId: reviewPacketId(visuallyCompared, "review-design"),
        verdict: "approved",
        summary: "Feature design passed.",
        findings: [],
        requirements: [{ id: "checkout-feature", verdict: "accepted" }],
        artifactPaths: ["visual/diff.png"],
        gateResults: [
          {
            id: "visual",
            status: "passed",
            evidencePaths: ["visual/diff.png"],
          },
          {
            id: "accessibility",
            status: "passed",
            evidencePaths: ["visual/diff.png"],
          },
        ],
      },
    });
    const runWithVisualArtifacts = await store.get(started.runId);
    const contractsReport = runWithVisualArtifacts.artifacts.find(
      (artifact) =>
        artifact.kind === "agent-result-report" &&
        artifact.metadata["workflowSubmissionKind"] === "contracts",
    );
    if (contractsReport === undefined) throw new Error("Missing contracts report");
    runWithVisualArtifacts.artifacts.push(
      ArtifactRefSchema.parse({
        ...contractsReport,
        id: createArtifactId(),
        kind: "screenshot",
        metadata: {
          adapter: "workflow-v2-evidence",
          workflowSubmissionKind: "contracts",
          visualRole: "baseline",
        },
      }),
    );
    runWithVisualArtifacts.revision += 1;
    runWithVisualArtifacts.updatedAt = new Date().toISOString();
    await store.save(runWithVisualArtifacts, runWithVisualArtifacts.revision - 1);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
        verdict: "approved",
        summary: "Targeted feature test passed.",
        findings: [],
        requirements: [{ id: "checkout-feature", verdict: "accepted" }],
        artifactPaths: ["test-results/checkout.json"],
        gateResults: [
          {
            id: "functional",
            status: "passed",
            evidencePaths: ["test-results/checkout.json"],
          },
          {
            id: "performance",
            status: "passed",
            evidencePaths: ["test-results/checkout.json"],
          },
        ],
      },
    });
    await service.advance({ runId: started.runId, until: "report" });
    const report = await reportMarkdown(store, artifactStore, started.runId);
    expect(report).toContain("## 실행 메타데이터");
    expect(report).toContain("<summary>실행 정보, 입력 출처, 변경 파일, 검증 자료 보기</summary>");
    expect(report).toContain("docs/architecture/ARCHITECTURE.md");
    expect(report).toContain("docs/rules&#92;n&#35;&#35; Injected heading");
    expect(report).not.toContain("\n## Injected heading");
    expect(report).not.toContain("<!-- injected-comment -->");
    expect(report).toContain("AGENTS.md");
    expect(report).not.toContain("not-installed");
    expect(report).toContain("## 요구사항");
    expect(report).toContain("test-results/checkout.mp4");
    const readyRun = await store.get(started.runId);
    const jsonReportArtifact = readyRun.artifacts.find(
      (artifact) => artifact.metadata["reportKind"] === "pr-report-v2-json",
    );
    if (jsonReportArtifact === undefined) throw new Error("Missing pr-report-v2 JSON");
    const jsonReport = JSON.parse(
      (await artifactStore.readContent(jsonReportArtifact.digest)).toString("utf8"),
    ) as Record<string, unknown>;
    expect(jsonReport).toMatchObject({
      schemaVersion: "pr-report-v2.1",
      sectionStatuses: {
        api: "complete",
        legacy: "not-applicable",
        visual: "complete",
        "functional-review": "complete",
        "design-review": "complete",
        performance: "complete",
        "feature-evidence": "complete",
      },
      mode: "feature",
      api: {
        applicable: true,
        operations: [expect.objectContaining({ operationKey: "POST /checkout" })],
      },
      visual: {
        applicable: true,
        status: "passed",
        results: [
          expect.objectContaining({
            targetId: "checkout-default",
            metrics: expect.objectContaining({ threshold: 0.92 }),
          }),
        ],
      },
      performance: {
        applicable: true,
        evidence: {
          field: { status: "unavailable" },
          lab: { metrics: { tbtMs: 120 } },
        },
      },
      featureEvidence: { testCount: 1, videoPath: "test-results/checkout.mp4" },
    });
    expect(JSON.stringify(jsonReport)).not.toContain('"inpMs":120');
  });

  it("rejects malformed Figma manifests and fake visual files", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: `Implement ${FIGMA_URL}`,
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl: FIGMA_URL,
    });
    const submission = {
      kind: "figma-bundle",
      provider: "host-connected-figma",
      capturedAt: "2026-07-13T00:00:00.000Z",
      fileUrl: FIGMA_URL,
      fileUrls: [FIGMA_URL],
      nodeIds: ["1:2"],
      capturedComponents: figmaCapturedComponents(),
      designMapping: figmaDesignMapping(),
      manifestPath: "figma/design-context.json",
      stateContracts: figmaStateContracts(),
      visualTargets: figmaVisualTargets(),
      artifactPaths: ["figma/design-context.json", "visual/diff.png"],
    } as const;

    await writeFile(path.join(directory, submission.manifestPath), "not json", "utf8");
    await expect(service.submit({ runId: started.runId, submission })).rejects.toThrow(
      /Figma manifest/i,
    );

    for (const nodeIds of [[], ["9:9"], ["1:2", "9:9"], ["1:2", "1:2"]]) {
      await writeFile(
        path.join(directory, submission.manifestPath),
        JSON.stringify({ ...figmaManifest(), nodeIds }),
        "utf8",
      );
      await expect(service.submit({ runId: started.runId, submission })).rejects.toThrow(
        /FIGMA_STATE_CONTRACT_INVALID.*nodeIds/i,
      );
    }

    await writeFile(
      path.join(directory, submission.manifestPath),
      JSON.stringify(figmaManifest()),
      "utf8",
    );
    await writeFile(path.join(directory, "visual/diff.png"), "not png", "utf8");
    await expect(service.submit({ runId: started.runId, submission })).rejects.toThrow(
      /valid PNG/i,
    );
  });

  it("requires reacquisition for historical v1 Figma geometry before attempt reservation", async () => {
    const figmaUrl = "https://www.figma.com/design/abc/file?node-id=2558-4382";
    const target = {
      targetId: "shop-list",
      name: "Shop list",
      state: "default",
      route: "/shop",
      baselineKind: "figma" as const,
      baselinePath: "visual/figma-thumbnail.png",
      viewport: { width: 202, height: 1024 },
      deviceScaleFactor: 1,
      fixture: "mock:shop-list",
      figmaCapture: {
        nodeId: "2558:4382",
        captureKind: "full-frame" as const,
        logicalSize: { width: 360, height: 1824 },
        exportScale: 202 / 360,
        bitmapSize: { width: 202, height: 1024 },
        colorSpace: "srgb" as const,
      },
      masks: [],
    };
    const thumbnail = new PNG({ width: 202, height: 1024 });
    await writeFile(path.join(directory, target.baselinePath), PNG.sync.write(thumbnail));
    await writeFile(
      path.join(directory, "figma/design-context.json"),
      JSON.stringify({
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: figmaUrl,
        fileUrls: [figmaUrl],
        nodeIds: ["2558:4382"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        visualPaths: [target.baselinePath],
        stateContracts: figmaStateContracts({
          targetId: target.targetId,
          nodeId: target.figmaCapture.nodeId,
          state: target.state,
          fixtureId: target.fixture,
        }),
        visualTargets: [target],
      }),
      "utf8",
    );
    const started = await service.start({
      projectRoot: directory,
      requestText: `Implement ${figmaUrl}`,
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl,
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "figma-bundle",
          provider: "host-connected-figma",
          capturedAt: "2026-07-13T00:00:00.000Z",
          fileUrl: figmaUrl,
          fileUrls: [figmaUrl],
          nodeIds: ["2558:4382"],
          capturedComponents: figmaCapturedComponents(),
          designMapping: figmaDesignMapping(),
          manifestPath: "figma/design-context.json",
          stateContracts: figmaStateContracts({
            targetId: target.targetId,
            nodeId: target.figmaCapture.nodeId,
            state: target.state,
            fixtureId: target.fixture,
          }),
          visualTargets: [target],
          artifactPaths: ["figma/design-context.json", target.baselinePath],
        },
      }),
    ).rejects.toThrow(/FIGMA_CAPTURE_GEOMETRY_REACQUISITION_REQUIRED/);
    const afterRejection = await store.get(started.runId);
    expect(
      afterRejection.artifacts.filter(
        (artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3",
      ),
    ).toHaveLength(0);
  });

  it("rejects persisted v1 Figma geometry without mutating attempt state", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: `Implement ${FIGMA_URL}`,
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl: FIGMA_URL,
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Figma state contract ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("figma-screen"),
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'v1-seed';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Implementation ready for visual comparison.",
        apiReady: false,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/unit.json", "mocks/manifest.json", "mocks/checkout.json"],
        mockDataEvidence: {
          manifestPath: "mocks/manifest.json",
          fixtures: [
            {
              id: "mock:checkout",
              path: "mocks/checkout.json",
              stateContractDigest: figmaStateContracts()[0]!.digest,
            },
          ],
        },
      },
    });
    const compareAction = implemented.nextActions.find(
      (action) => action.kind === "compare-visuals",
    );
    if (compareAction === undefined || !("reviewPacketId" in compareAction)) {
      throw new Error("Missing visual comparison action");
    }

    const seededRun = await store.get(started.runId);
    const bundleIndex = seededRun.artifacts.findIndex(
      (artifact) =>
        artifact.metadata["workflowSubmissionKind"] === "figma-bundle" &&
        Array.isArray(artifact.metadata["visualTargets"]),
    );
    if (bundleIndex < 0) throw new Error("Missing persisted Figma targets");
    const bundle = seededRun.artifacts[bundleIndex]!;
    seededRun.artifacts[bundleIndex] = ArtifactRefSchema.parse({
      ...bundle,
      metadata: {
        ...bundle.metadata,
        visualTargets: [
          {
            ...figmaVisualTargets()[0]!,
            figmaCapture: {
              nodeId: "1:2",
              captureKind: "viewport",
              logicalSize: { width: 1, height: 1 },
              exportScale: 1,
              bitmapSize: { width: 1, height: 1 },
              colorSpace: "srgb",
            },
          },
        ],
      },
    });
    seededRun.revision += 1;
    seededRun.updatedAt = new Date().toISOString();
    await store.save(seededRun, seededRun.revision - 1);

    const before = await store.get(started.runId);
    const beforeBytes = JSON.stringify(before);
    const actualPath = `visual/actual/${compareAction.reviewPacketId}/checkout-default.png`;
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "visual-comparison",
          reviewPacketId: compareAction.reviewPacketId,
          captures: [
            {
              targetId: "checkout-default",
              route: "/checkout",
              state: "default",
              viewport: { width: 1, height: 1 },
              deviceScaleFactor: 1,
              fixture: "mock:checkout",
              provider: "playwright",
              capturedAt: "2026-07-20T00:00:00.000Z",
              actualPath,
              actualDigest: `sha256:${"a".repeat(64)}`,
            },
          ],
          artifactPaths: [actualPath],
        },
      }),
    ).rejects.toThrow(/FIGMA_CAPTURE_GEOMETRY_REACQUISITION_REQUIRED/);
    const after = await store.get(started.runId);
    expect(JSON.stringify(after)).toBe(beforeBytes);
    expect(
      after.artifacts.filter(
        (artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3",
      ),
    ).toEqual(
      before.artifacts.filter(
        (artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3",
      ),
    );
  });

  it("records at most one Figma bundle under concurrent submissions", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: `Implement ${FIGMA_URL}`,
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl: FIGMA_URL,
    });
    const input = {
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    } as const;

    const results = await Promise.allSettled([service.submit(input), service.submit(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const run = await store.get(started.runId);
    expect(
      run.artifacts.filter((artifact) => artifact.kind === "figma-design-context"),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: "review packet ID",
      mutate: (run: Awaited<ReturnType<typeof store.get>>) => ({
        ...run,
        stages: run.stages.map((item) =>
          item.name === "implementation"
            ? {
                ...item,
                checkpoint: {
                  ...item.checkpoint!,
                  data: {
                    ...item.checkpoint!.data,
                    reviewPacket: {
                      ...(item.checkpoint!.data["reviewPacket"] as Record<string, unknown>),
                      id: `packet_${"a".repeat(64)}`,
                    },
                  },
                },
              }
            : item,
        ),
      }),
    },
    {
      name: "review packet head",
      mutate: (run: Awaited<ReturnType<typeof store.get>>) => ({
        ...run,
        stages: run.stages.map((item) =>
          item.name === "implementation"
            ? {
                ...item,
                checkpoint: {
                  ...item.checkpoint!,
                  data: {
                    ...item.checkpoint!.data,
                    reviewPacket: {
                      ...(item.checkpoint!.data["reviewPacket"] as Record<string, unknown>),
                      headSha: "a".repeat(40),
                    },
                  },
                },
              }
            : item,
        ),
      }),
    },
    {
      name: "review packet diff",
      mutate: (run: Awaited<ReturnType<typeof store.get>>) => ({
        ...run,
        stages: run.stages.map((item) =>
          item.name === "implementation"
            ? {
                ...item,
                checkpoint: {
                  ...item.checkpoint!,
                  data: {
                    ...item.checkpoint!.data,
                    reviewPacket: {
                      ...(item.checkpoint!.data["reviewPacket"] as Record<string, unknown>),
                      diffDigest: `sha256:${"a".repeat(64)}`,
                    },
                  },
                },
              }
            : item,
        ),
      }),
    },
    {
      name: "implementation state",
      mutate: (run: Awaited<ReturnType<typeof store.get>>) => ({
        ...run,
        stages: run.stages.map((item) =>
          item.name === "implementation"
            ? {
                ...item,
                status: "failed" as const,
                completedAt: new Date().toISOString(),
                error: {
                  code: "IMPLEMENTATION_REPLACED",
                  message: "Implementation was superseded while review evidence was being stored.",
                  retryable: true,
                },
              }
            : item,
        ),
      }),
    },
    {
      name: "terminal visual threshold",
      mutate: (run: Awaited<ReturnType<typeof store.get>>) => ({
        ...run,
        status: "blocked" as const,
        stages: run.stages.map((item) => {
          if (item.name === "implementation") {
            return {
              ...item,
              status: "failed" as const,
              completedAt: new Date().toISOString(),
              checkpoint: {
                name: "visual-threshold-not-met",
                data: {
                  ...item.checkpoint!.data,
                  visualTerminalIdentity: `sha256:${"a".repeat(64)}`,
                },
                updatedAt: new Date().toISOString(),
              },
              error: {
                code: "VISUAL_REVIEW_THRESHOLD_NOT_MET",
                message: "The visual threshold was not met.",
                retryable: false,
              },
            };
          }
          if (item.name === "functional-review" || item.name === "design-review") {
            return {
              ...item,
              status: "pending" as const,
              attempt: 0,
              startedAt: undefined,
              completedAt: undefined,
              lease: undefined,
              checkpoint: undefined,
              artifactIds: [],
              gapIds: [],
              error: undefined,
            };
          }
          return item;
        }),
      }),
    },
  ])("rejects late reviewer evidence after a changed $name", async ({ mutate }) => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser with covered behavior.",
      scope: "non-ui",
      publication: "none",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Parser contract ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("parser"),
      },
    });
    await changeSource(directory, "src/parser.ts", "export const parser = 'review-race';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Parser implemented.",
        apiReady: false,
        uiChanged: false,
        changedFiles: ["src/parser.ts"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    const reviewerEvidenceIngested = deferred<void>();
    const releaseReviewerEvidence = deferred<void>();
    const originalWriteBlob = artifactStore.writeBlob.bind(artifactStore);
    const writeBlobSpy = vi.spyOn(artifactStore, "writeBlob").mockImplementation(async (input) => {
      if (input.label === "unit.json") {
        reviewerEvidenceIngested.resolve();
        await releaseReviewerEvidence.promise;
      }
      return originalWriteBlob(input);
    });
    const lateReview = service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
        verdict: "approved",
        summary: "Functional evidence passed.",
        findings: [],
        requirements: [{ id: "parser", verdict: "accepted" }],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [
          { id: "functional", status: "passed", evidencePaths: ["test-results/unit.json"] },
        ],
      },
    });

    await reviewerEvidenceIngested.promise;
    const current = await store.get(started.runId);
    const terminal = mutate(current);
    await store.save(
      { ...terminal, revision: current.revision + 1, updatedAt: new Date().toISOString() },
      current.revision,
    );
    const expectedTerminal = await store.get(started.runId);
    releaseReviewerEvidence.resolve();
    await expect(lateReview).rejects.toThrow(/REVIEW_PACKET_STALE|visual threshold/i);
    writeBlobSpy.mockRestore();

    const afterLateReview = await store.get(started.runId);
    expect(afterLateReview).toEqual(expectedTerminal);
  });

  it("accepts a sibling reviewer after another reviewer advances the same packet revision", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement a large enough UI change to use parallel reviewers.",
      scope: "ui",
      publication: "none",
    });
    const startedRun = await store.get(started.runId);
    await store.save(
      {
        ...startedRun,
        revision: startedRun.revision + 1,
        stages: startedRun.stages.map((item) =>
          item.name === "intake"
            ? {
                ...item,
                checkpoint: {
                  ...item.checkpoint!,
                  data: {
                    ...item.checkpoint!.data,
                    workload: {
                      size: "L",
                      score: 51,
                      confidence: "high",
                      source: "contracts",
                      tokenRange: { min: 160_000, max: 320_000 },
                      budget: {
                        checkpointPercent: 80,
                        checkpointAtTokens: 256_000,
                        hardLimitTokens: 320_000,
                      },
                      sampleCount: 1,
                      reasons: ["parallel reviewer coverage"],
                    },
                  },
                },
              }
            : item,
        ),
      },
      startedRun.revision,
    );
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "UI contract ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout"),
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'parallel';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Checkout implemented.",
        apiReady: false,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    const packetId = reviewPacketId(implemented, "review-functional");
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: packetId,
        verdict: "approved",
        summary: "Functional evidence passed.",
        findings: [],
        requirements: [{ id: "checkout", verdict: "accepted" }],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [
          { id: "functional", status: "passed", evidencePaths: ["test-results/unit.json"] },
        ],
      },
    });
    const design = await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        reviewPacketId: packetId,
        verdict: "approved",
        summary: "Design evidence passed.",
        requirements: [{ id: "checkout", verdict: "accepted" }],
        artifactPaths: ["visual/diff.png"],
        gateResults: [
          { id: "visual", status: "passed", evidencePaths: ["visual/diff.png"] },
          { id: "accessibility", status: "passed", evidencePaths: ["visual/diff.png"] },
        ],
      },
    });

    expect(design.stages).toEqual(
      expect.arrayContaining([
        { name: "functional-review", status: "passed" },
        { name: "design-review", status: "passed" },
      ]),
    );
  });

  it("repairs implementation across packets and blocks after three visual comparison failures", async () => {
    const baseline = new PNG({ width: 1, height: 1 });
    baseline.data.set([0, 0, 0, 255]);
    await writeFile(path.join(directory, "visual/diff.png"), PNG.sync.write(baseline));
    await execFileAsync("git", ["add", "visual/diff.png"], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "opaque visual baseline"], { cwd: directory });
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement the supplied checkout design",
      scope: "ui",
      mode: "figma",
      changeKind: "design",
      figmaUrl: FIGMA_URL,
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "figma-bundle",
        provider: "host-connected-figma",
        capturedAt: "2026-07-13T00:00:00.000Z",
        fileUrl: FIGMA_URL,
        fileUrls: [FIGMA_URL],
        nodeIds: ["1:2"],
        capturedComponents: figmaCapturedComponents(),
        designMapping: figmaDesignMapping(),
        manifestPath: "figma/design-context.json",
        stateContracts: figmaStateContracts(),
        visualTargets: figmaVisualTargets(),
        artifactPaths: ["figma/design-context.json", "visual/diff.png"],
      },
    });
    const secondTarget = {
      ...figmaVisualTargets()[0]!,
      targetId: "checkout-summary",
      name: "Checkout summary",
      state: "summary",
      fixture: "mock:summary",
      figmaCapture: {
        ...figmaVisualTargets()[0]!.figmaCapture,
        nodeId: "1:3",
        state: "summary",
      },
    };
    const runWithTwoTargets = await store.get(started.runId);
    const figmaBundleArtifactIndex = runWithTwoTargets.artifacts.findIndex(
      (artifact) =>
        artifact.metadata["workflowSubmissionKind"] === "figma-bundle" &&
        Array.isArray(artifact.metadata["visualTargets"]),
    );
    if (figmaBundleArtifactIndex < 0) throw new Error("Missing persisted Figma bundle");
    const originalFigmaBundleArtifact = runWithTwoTargets.artifacts[figmaBundleArtifactIndex]!;
    const originalVisualTargets = originalFigmaBundleArtifact.metadata["visualTargets"];
    if (!Array.isArray(originalVisualTargets)) throw new Error("Missing persisted visual targets");
    const originalStateContracts = originalFigmaBundleArtifact.metadata["stateContracts"];
    if (!Array.isArray(originalStateContracts))
      throw new Error("Missing persisted state contracts");
    runWithTwoTargets.artifacts[figmaBundleArtifactIndex] = ArtifactRefSchema.parse({
      ...originalFigmaBundleArtifact,
      metadata: {
        ...originalFigmaBundleArtifact.metadata,
        visualTargets: [...originalVisualTargets, secondTarget],
        stateContracts: [
          ...originalStateContracts,
          ...figmaStateContracts({
            targetId: secondTarget.targetId,
            nodeId: secondTarget.figmaCapture.nodeId,
            state: secondTarget.state,
            fixtureId: secondTarget.fixture,
          }),
        ],
      },
    });
    runWithTwoTargets.revision += 1;
    runWithTwoTargets.updatedAt = new Date().toISOString();
    await store.save(runWithTwoTargets, runWithTwoTargets.revision - 1);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Design contract ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("figma-screen"),
      },
    });
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'visual';\n");
    const summaryFixture = Buffer.from(JSON.stringify([{ state: "summary" }]), "utf8");
    await writeFile(path.join(directory, "mocks/summary.json"), summaryFixture);
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Rendered without a deterministic mock contract.",
          apiReady: false,
          uiChanged: true,
          changedFiles: ["src/checkout.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow(/deterministic mock/i);
    const implementationSubmission = {
      kind: "implementation",
      status: "passed",
      summary: "Rendered the checkout target.",
      apiReady: false,
      uiChanged: true,
      changedFiles: [
        "mocks/checkout.json",
        "mocks/manifest.json",
        "mocks/summary.json",
        "src/checkout.tsx",
      ],
      artifactPaths: [
        "test-results/unit.json",
        "mocks/manifest.json",
        "mocks/checkout.json",
        "mocks/summary.json",
      ],
      mockDataEvidence: {
        manifestPath: "mocks/manifest.json",
        fixtures: [
          {
            id: "mock:checkout",
            path: "mocks/checkout.json",
            stateContractDigest: figmaStateContracts()[0]!.digest,
          },
          {
            id: "mock:summary",
            path: "mocks/summary.json",
            stateContractDigest: figmaStateContracts({
              targetId: secondTarget.targetId,
              nodeId: secondTarget.figmaCapture.nodeId,
              state: secondTarget.state,
              fixtureId: secondTarget.fixture,
            })[0]!.digest,
          },
        ],
      },
    } as const;
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          ...implementationSubmission,
          mockDataEvidence: {
            manifestPath: "mocks/manifest.json",
            fixtures: [{ id: "mock:unrelated", path: "mocks/checkout.json" }],
          },
        },
      }),
    ).rejects.toThrow(/MOCK_FIXTURE_ID_MISMATCH.*mock:checkout.*mock:unrelated/);
    for (const invalidFixture of ["not json", "null", "1", '"scalar"']) {
      await writeFile(path.join(directory, "mocks/checkout.json"), invalidFixture, "utf8");
      await expect(
        service.submit({ runId: started.runId, submission: implementationSubmission }),
      ).rejects.toThrow(/Mock fixture/i);
    }
    const validFixture = Buffer.from(JSON.stringify([{ state: "checkout" }]), "utf8");
    await writeFile(path.join(directory, "mocks/checkout.json"), validFixture);
    await writeFile(
      path.join(directory, "mocks/manifest.json"),
      JSON.stringify({
        deterministic: true,
        fixtures: [
          {
            id: "mock:checkout",
            path: "mocks/checkout.json",
            sha256: `sha256:${"0".repeat(64)}`,
            stateContractDigest: figmaStateContracts()[0]!.digest,
          },
          {
            id: "mock:summary",
            path: "mocks/summary.json",
            sha256: `sha256:${createHash("sha256").update(summaryFixture).digest("hex")}`,
            stateContractDigest: figmaStateContracts({
              targetId: secondTarget.targetId,
              nodeId: secondTarget.figmaCapture.nodeId,
              state: secondTarget.state,
              fixtureId: secondTarget.fixture,
            })[0]!.digest,
          },
        ],
      }),
      "utf8",
    );
    await expect(
      service.submit({ runId: started.runId, submission: implementationSubmission }),
    ).rejects.toThrow(/SHA-256 digests/i);
    await writeFile(
      path.join(directory, "mocks/manifest.json"),
      JSON.stringify({
        deterministic: true,
        fixtures: [
          {
            id: "mock:unrelated",
            path: "mocks/checkout.json",
            sha256: `sha256:${createHash("sha256").update(validFixture).digest("hex")}`,
          },
        ],
      }),
      "utf8",
    );
    await expect(
      service.submit({ runId: started.runId, submission: implementationSubmission }),
    ).rejects.toThrow(/fixture IDs, paths, and SHA-256 digests/i);
    await writeFile(
      path.join(directory, "mocks/manifest.json"),
      JSON.stringify({
        deterministic: true,
        fixtures: [
          {
            id: "mock:checkout",
            path: "mocks/checkout.json",
            sha256: `sha256:${createHash("sha256").update(validFixture).digest("hex")}`,
            stateContractDigest: figmaStateContracts()[0]!.digest,
          },
          {
            id: "mock:summary",
            path: "mocks/summary.json",
            sha256: `sha256:${createHash("sha256").update(summaryFixture).digest("hex")}`,
            stateContractDigest: figmaStateContracts({
              targetId: secondTarget.targetId,
              nodeId: secondTarget.figmaCapture.nodeId,
              state: secondTarget.state,
              fixtureId: secondTarget.fixture,
            })[0]!.digest,
          },
        ],
      }),
      "utf8",
    );
    const implemented = await service.submit({
      runId: started.runId,
      submission: implementationSubmission,
    });
    const compareAction = implemented.nextActions.find(
      (action) => action.kind === "compare-visuals",
    );
    if (compareAction === undefined || !("reviewPacketId" in compareAction)) {
      throw new Error("Missing visual comparison action");
    }
    const implementationRun = await store.get(started.runId);
    const implementationArtifact = [...implementationRun.artifacts]
      .reverse()
      .find(
        (artifact) =>
          artifact.kind === "agent-result-report" &&
          artifact.metadata["workflowSubmissionKind"] === "implementation",
      );
    const implementationPacket = implementationArtifact?.metadata["reviewPacket"] as
      { headSha?: unknown } | undefined;
    if (typeof implementationPacket?.headSha !== "string") {
      throw new Error("Missing implementation packet head");
    }

    const actualDirectory = path.join(directory, "visual", "actual", compareAction.reviewPacketId);
    await mkdir(actualDirectory, { recursive: true });
    const visualSubmission = async (
      action: { reviewPacketId: string },
      packetHeadSha: string,
      name: string,
      rgba: [number, number, number, number],
      withReceipt = true,
      fixtureDigestOverride?: string,
      secondRgba: [number, number, number, number] = rgba,
    ) => {
      const captureFor = async (
        targetId: string,
        suffix: string,
        pixels: [number, number, number, number],
      ) => {
        const isSummary = targetId === "checkout-summary";
        const targetState = isSummary ? "summary" : "default";
        const fixtureId = isSummary ? "mock:summary" : "mock:checkout";
        const fixtureBytes = isSummary ? summaryFixture : validFixture;
        const image = new PNG({ width: 1, height: 1 });
        image.data.set(pixels);
        const actualPath = `visual/actual/${action.reviewPacketId}/${name}-${suffix}.png`;
        const bytes = PNG.sync.write(image);
        await mkdir(path.dirname(path.join(directory, actualPath)), { recursive: true });
        await writeFile(path.join(directory, actualPath), bytes);
        const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
        const receiptPath = `visual/actual/${action.reviewPacketId}/${name}-${suffix}.json`;
        const receiptBytes = Buffer.from(
          JSON.stringify({
            reviewPacketId: action.reviewPacketId,
            headSha: packetHeadSha,
            targetId,
            route: "/checkout",
            state: targetState,
            captureKind: "viewport",
            logicalSize: { width: 1, height: 1 },
            deviceScaleFactor: 1,
            playwrightVersion: "1.54.1",
            browserName: "chromium",
            browserVersion: "138.0.7204.168",
            locale: "ko-KR",
            colorScheme: "light",
            timezone: "Asia/Seoul",
            userAgent: "Mozilla/5.0 Chromium",
            fonts: [],
            fixture: {
              id: fixtureId,
              digest:
                fixtureDigestOverride ??
                `sha256:${createHash("sha256").update(fixtureBytes).digest("hex")}`,
            },
            assets: [],
            assetsComplete: true,
            actual: {
              path: actualPath,
              digest: actualDigest,
              bitmapSize: { width: 1, height: 1 },
            },
            runnerVersion: "capture-runner-v1",
            normalizerVersion: "visual-normalizer-v1",
            capturedAt: "2026-07-20T00:00:00.000Z",
          }),
          "utf8",
        );
        if (withReceipt) {
          await writeFile(path.join(directory, receiptPath), receiptBytes);
        }
        return {
          targetId,
          route: "/checkout",
          state: targetState,
          viewport: { width: 1, height: 1 },
          deviceScaleFactor: 1,
          fixture: fixtureId,
          provider: "playwright",
          capturedAt: "2026-07-20T00:00:00.000Z",
          actualPath,
          actualDigest,
          ...(withReceipt
            ? {
                receiptPath,
                receiptDigest:
                  `sha256:${createHash("sha256").update(receiptBytes).digest("hex")}` as const,
              }
            : {}),
        };
      };
      const captures = [
        await captureFor("checkout-default", "default", rgba),
        await captureFor("checkout-summary", "summary", secondRgba),
      ];
      return {
        kind: "visual-comparison" as const,
        reviewPacketId: action.reviewPacketId,
        captures,
        artifactPaths: captures.flatMap((capture) => [
          capture.actualPath,
          ...(capture.receiptPath === undefined ? [] : [capture.receiptPath]),
        ]),
      };
    };

    const appendVisualReservation = async (input: {
      submissionIdentity: string;
      ownerToken: string;
      status: "in-progress" | "aborted";
    }) => {
      const timestamp = new Date().toISOString();
      const reservation = {
        reviewPacketId: compareAction.reviewPacketId,
        visualLineageId: compareAction.reviewPacketId,
        submissionIdentity: input.submissionIdentity,
        attempt: 1,
        status: input.status,
        ownerToken: input.ownerToken,
        reservedAt: timestamp,
        updatedAt: timestamp,
      };
      const blob = await artifactStore.writeBlob({
        content: Buffer.from(`${JSON.stringify(reservation)}\n`, "utf8"),
        mediaType: "application/json",
        storedAt: timestamp,
        label: `manual-${input.status}.json`,
      });
      const current = await store.get(started.runId);
      await store.save(
        {
          ...current,
          revision: current.revision + 1,
          updatedAt: timestamp,
          artifacts: [
            ...current.artifacts,
            ArtifactRefSchema.parse({
              id: createArtifactId(),
              kind: "other",
              uri: blob.uri,
              mediaType: "application/json",
              digest: blob.digest,
              producedBy: "orchestrator",
              evidenceIds: [],
              createdAt: timestamp,
              metadata: {
                adapter: "visual-attempt-reservation-v3",
                reviewPacketId: compareAction.reviewPacketId,
                visualLineageId: compareAction.reviewPacketId,
                submissionIdentity: input.submissionIdentity,
                visualComparisonAttempt: 1,
                reservationStatus: input.status,
                ownerToken: input.ownerToken,
                reservedAt: timestamp,
                updatedAt: timestamp,
              },
            }),
          ],
        },
        current.revision,
      );
    };

    const busySubmission = await visualSubmission(
      compareAction,
      implementationPacket.headSha,
      "busy",
      [255, 255, 255, 255],
    );
    await appendVisualReservation({
      submissionIdentity: "manual-active-submission",
      ownerToken: "manual-active-owner",
      status: "in-progress",
    });
    const busyWriteSpy = vi.spyOn(artifactStore, "writeBlob");
    await expect(
      service.submit({ runId: started.runId, submission: busySubmission }),
    ).rejects.toThrow(/VISUAL_ATTEMPT_IN_PROGRESS/);
    expect(busyWriteSpy).not.toHaveBeenCalled();
    busyWriteSpy.mockRestore();
    await appendVisualReservation({
      submissionIdentity: "manual-active-submission",
      ownerToken: "manual-active-owner",
      status: "aborted",
    });

    const invalidPng = await visualSubmission(
      compareAction,
      implementationPacket.headSha,
      "invalid-png",
      [255, 255, 255, 255],
    );
    const invalidPngBytes = Buffer.from("not a png", "utf8");
    await writeFile(path.join(directory, invalidPng.captures[0]!.actualPath), invalidPngBytes);
    invalidPng.captures[0]!.actualDigest =
      `sha256:${createHash("sha256").update(invalidPngBytes).digest("hex")}` as const;
    const beforeInvalidPng = await store.get(started.runId);
    const reservationCountBeforeInvalidPng = beforeInvalidPng.artifacts.filter(
      (artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3",
    ).length;
    await expect(service.submit({ runId: started.runId, submission: invalidPng })).rejects.toThrow(
      /PNG/i,
    );
    const afterInvalidPng = await store.get(started.runId);
    expect(
      afterInvalidPng.artifacts
        .filter((artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3")
        .slice(reservationCountBeforeInvalidPng)
        .map((artifact) => ({
          attempt: artifact.metadata["visualComparisonAttempt"],
          status: artifact.metadata["reservationStatus"],
        })),
    ).toEqual([
      { attempt: 1, status: "in-progress" },
      { attempt: 1, status: "aborted" },
    ]);
    expect(
      (await service.status({ runId: started.runId })).nextActions.find(
        (action) => action.kind === "compare-visuals",
      ),
    ).toMatchObject({ attempt: 1 });

    const receiptless = await visualSubmission(
      compareAction,
      implementationPacket.headSha,
      "missing-receipt",
      [255, 255, 255, 255],
      false,
    );
    await expect(service.submit({ runId: started.runId, submission: receiptless })).rejects.toThrow(
      /VISUAL_CAPTURE_PROVENANCE_INVALID/,
    );
    const beforeValidCapture = await store.get(started.runId);
    const receiptlessReservations = beforeValidCapture.artifacts.filter(
      (artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3",
    );
    expect(
      receiptlessReservations.slice(-2).map((artifact) => ({
        attempt: artifact.metadata["visualComparisonAttempt"],
        status: artifact.metadata["reservationStatus"],
      })),
    ).toEqual([
      { attempt: 1, status: "in-progress" },
      { attempt: 1, status: "aborted" },
    ]);
    const wrongFixtureReceipt = await visualSubmission(
      compareAction,
      implementationPacket.headSha,
      "wrong-fixture",
      [255, 255, 255, 255],
      true,
      `sha256:${"9".repeat(64)}`,
    );
    await expect(
      service.submit({ runId: started.runId, submission: wrongFixtureReceipt }),
    ).rejects.toThrow(/MOCK_FIXTURE_NOT_CONSUMED/);
    const afterWrongFixture = await store.get(started.runId);
    const wrongFixtureReservations = afterWrongFixture.artifacts.filter(
      (artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3",
    );
    expect(
      wrongFixtureReservations.slice(-2).map((artifact) => ({
        attempt: artifact.metadata["visualComparisonAttempt"],
        status: artifact.metadata["reservationStatus"],
      })),
    ).toEqual([
      { attempt: 1, status: "in-progress" },
      { attempt: 1, status: "aborted" },
    ]);

    const packetHeadFor = async (reviewPacketId: string) => {
      const current = await store.get(started.runId);
      const packetArtifact = [...current.artifacts].reverse().find((artifact) => {
        const candidate = artifact.metadata["reviewPacket"] as { id?: unknown } | undefined;
        return candidate?.id === reviewPacketId;
      });
      const candidate = packetArtifact?.metadata["reviewPacket"] as
        { headSha?: unknown } | undefined;
      if (typeof candidate?.headSha !== "string") {
        throw new Error(`Missing packet head for ${reviewPacketId}`);
      }
      return candidate.headSha;
    };

    const persistedTargets = await store.get(started.runId);
    let figmaBundleIndex = -1;
    for (let index = persistedTargets.artifacts.length - 1; index >= 0; index -= 1) {
      if (
        persistedTargets.artifacts[index]?.metadata["workflowSubmissionKind"] === "figma-bundle"
      ) {
        figmaBundleIndex = index;
        break;
      }
    }
    if (figmaBundleIndex < 0) throw new Error("Missing persisted Figma target manifest");
    const figmaBundleArtifact = persistedTargets.artifacts[figmaBundleIndex]!;
    expect(figmaBundleArtifact.metadata["visualTargets"]).toEqual([
      expect.objectContaining({ reviewThreshold: 0.92 }),
      expect.objectContaining({ targetId: "checkout-summary" }),
    ]);
    const storedTargets = figmaBundleArtifact.metadata["visualTargets"];
    if (!Array.isArray(storedTargets)) throw new Error("Missing persisted visual targets");
    persistedTargets.artifacts[figmaBundleIndex] = ArtifactRefSchema.parse({
      ...figmaBundleArtifact,
      metadata: {
        ...figmaBundleArtifact.metadata,
        visualTargets: storedTargets.map((target) => ({
          ...(target as Record<string, unknown>),
          reviewThreshold: 0.98,
        })),
      },
    });
    persistedTargets.revision += 1;
    persistedTargets.updatedAt = new Date().toISOString();
    await store.save(persistedTargets, persistedTargets.revision - 1);

    const firstAttempt = await visualSubmission(
      compareAction,
      implementationPacket.headSha,
      "attempt-1",
      [255, 255, 255, 255],
      true,
      undefined,
      [0, 0, 0, 255],
    );
    const originalWriteBlob = artifactStore.writeBlob.bind(artifactStore);
    let failVisualDiffWrite = true;
    const writeBlobSpy = vi.spyOn(artifactStore, "writeBlob").mockImplementation(async (input) => {
      if (failVisualDiffWrite && input.label === "checkout-default.diff.png") {
        failVisualDiffWrite = false;
        throw new Error("injected visual diff blob failure");
      }
      return originalWriteBlob(input);
    });
    await expect(
      service.submit({
        runId: started.runId,
        submission: firstAttempt,
      }),
    ).rejects.toThrow(/injected visual diff blob failure/);
    writeBlobSpy.mockRestore();
    const afterAbortedAttempt = await store.get(started.runId);
    expect(
      afterAbortedAttempt.artifacts
        .filter((artifact) => artifact.metadata["adapter"] === "visual-attempt-reservation-v3")
        .slice(-2)
        .map((artifact) => ({
          attempt: artifact.metadata["visualComparisonAttempt"],
          status: artifact.metadata["reservationStatus"],
        })),
    ).toEqual([
      { attempt: 1, status: "in-progress" },
      { attempt: 1, status: "aborted" },
    ]);
    expect(
      (await service.status({ runId: started.runId })).nextActions.find(
        (action) => action.kind === "compare-visuals",
      ),
    ).toMatchObject({ attempt: 1 });

    const afterFirstFailure = await service.submit({
      runId: started.runId,
      submission: firstAttempt,
    });
    const afterCommittedAttempt = await store.get(started.runId);
    const revisionBeforeReplay = afterCommittedAttempt.revision;
    const reportCountBeforeReplay = afterCommittedAttempt.artifacts.filter(
      (artifact) => artifact.kind === "visual-report",
    ).length;
    const malformedCommittedReplay = {
      ...firstAttempt,
      captures: firstAttempt.captures.map((capture) => ({
        ...capture,
        route: "/wrong",
      })),
    };
    const replayWriteSpy = vi.spyOn(artifactStore, "writeBlob");
    await expect(
      service.submit({
        runId: started.runId,
        submission: malformedCommittedReplay,
      }),
    ).rejects.toThrow(/capture manifest.*target/i);
    expect(replayWriteSpy).not.toHaveBeenCalled();
    replayWriteSpy.mockRestore();
    await service.submit({
      runId: started.runId,
      submission: firstAttempt,
    });
    const afterReplay = await store.get(started.runId);
    expect(afterReplay.revision).toBe(revisionBeforeReplay);
    expect(
      afterReplay.artifacts.filter((artifact) => artifact.kind === "visual-report"),
    ).toHaveLength(reportCountBeforeReplay);
    const firstRepair = afterFirstFailure.nextActions.find(
      (action) => action.kind === "implementation-repair",
    );
    expect(firstRepair).toMatchObject({
      repairEvidenceVersion: "v2",
      reviewPacketId: compareAction.reviewPacketId,
      nextAttempt: 2,
      failedTargets: [
        expect.objectContaining({ targetId: "checkout-default", reviewMatchRatio: 0 }),
      ],
      repairEvidenceArtifactId: expect.stringMatching(/^art_[a-f0-9]{32}$/),
    });
    if (
      firstRepair === undefined ||
      firstRepair.kind !== "implementation-repair" ||
      firstRepair.repairEvidenceVersion !== "v2"
    ) {
      throw new Error("Missing v2 repair evidence action");
    }
    const afterFirstFailureRun = await store.get(started.runId);
    const repairEvidenceArtifact = afterFirstFailureRun.artifacts.find(
      (artifact) => artifact.id === firstRepair.repairEvidenceArtifactId,
    );
    if (repairEvidenceArtifact === undefined) throw new Error("Missing rich repair evidence");
    expect(
      JSON.parse((await artifactStore.readContent(repairEvidenceArtifact.digest)).toString("utf8")),
    ).toMatchObject({
      schemaVersion: "visual-repair-evidence-v2",
      lineageId: firstRepair.lineageId,
      reviewPacketId: firstRepair.reviewPacketId,
      headSha: implementationPacket.headSha,
      attempt: 1,
      failedTargets: [
        {
          targetId: "checkout-default",
          metrics: expect.objectContaining({ reviewMatchRatio: 0, threshold: 0.92 }),
          diffArtifactId: expect.stringMatching(/^art_[a-f0-9]{32}$/),
          overlayArtifactId: expect.stringMatching(/^art_[a-f0-9]{32}$/),
          captureSummary: {
            provider: "playwright",
            browser: "chromium 138.0.7204.168",
            fontsReady: false,
            assetsReady: true,
          },
          causeHints: ["implementation", "acquisition"],
        },
      ],
    });
    const originalRepairEvidencePayload = JSON.parse(
      (await artifactStore.readContent(repairEvidenceArtifact.digest)).toString("utf8"),
    ) as Record<string, unknown>;
    const replaceRepairEvidencePayload = async (payload: unknown) => {
      const timestamp = new Date().toISOString();
      const blob = await artifactStore.writeBlob({
        content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"),
        mediaType: "application/json",
        storedAt: timestamp,
        label: "tampered-visual-repair-evidence.json",
      });
      const current = await store.get(started.runId);
      current.artifacts = current.artifacts.map((artifact) =>
        artifact.id === repairEvidenceArtifact.id
          ? ArtifactRefSchema.parse({ ...artifact, uri: blob.uri, digest: blob.digest })
          : artifact,
      );
      current.revision += 1;
      current.updatedAt = timestamp;
      await store.save(current, current.revision - 1);
    };
    const { headSha: _headSha, ...missingHeadPayload } = originalRepairEvidencePayload;
    await replaceRepairEvidencePayload(missingHeadPayload);
    await expect(service.status({ runId: started.runId })).rejects.toThrow(
      /VISUAL_REPAIR_EVIDENCE_INVALID/,
    );
    await replaceRepairEvidencePayload({
      ...originalRepairEvidencePayload,
      headSha: "f".repeat(40),
    });
    await expect(service.status({ runId: started.runId })).rejects.toThrow(
      /VISUAL_REPAIR_EVIDENCE_INVALID/,
    );
    await replaceRepairEvidencePayload(originalRepairEvidencePayload);

    const malformedTimestamp = new Date().toISOString();
    const malformedBlob = await artifactStore.writeBlob({
      content: Buffer.from("{}\n", "utf8"),
      mediaType: "application/json",
      storedAt: malformedTimestamp,
      label: "malformed-newest-visual-repair-evidence.json",
    });
    const malformedArtifactId = createArtifactId();
    const runWithMalformedNewest = await store.get(started.runId);
    runWithMalformedNewest.artifacts.push(
      ArtifactRefSchema.parse({
        ...repairEvidenceArtifact,
        id: malformedArtifactId,
        uri: malformedBlob.uri,
        digest: malformedBlob.digest,
        createdAt: malformedTimestamp,
        metadata: {
          ...repairEvidenceArtifact.metadata,
          visualLineageAttempt: 2,
          repairEvidenceArtifactId: malformedArtifactId,
        },
      }),
    );
    runWithMalformedNewest.revision += 1;
    runWithMalformedNewest.updatedAt = malformedTimestamp;
    await store.save(runWithMalformedNewest, runWithMalformedNewest.revision - 1);
    await expect(service.status({ runId: started.runId })).rejects.toThrow(
      /VISUAL_REPAIR_EVIDENCE_INVALID/,
    );
    const malformedRun = await store.get(started.runId);
    malformedRun.artifacts = malformedRun.artifacts.filter(
      (artifact) => artifact.id !== malformedArtifactId,
    );
    malformedRun.revision += 1;
    malformedRun.updatedAt = new Date().toISOString();
    await store.save(malformedRun, malformedRun.revision - 1);
    const originalRepairEvidenceArtifact = repairEvidenceArtifact;
    const {
      repairEvidenceArtifactId: _repairEvidenceArtifactId,
      schemaVersion: _schemaVersion,
      ...legacyMetadata
    } = repairEvidenceArtifact.metadata;
    const legacyCandidateRun = await store.get(started.runId);
    legacyCandidateRun.artifacts = legacyCandidateRun.artifacts.map((artifact) =>
      artifact.id === repairEvidenceArtifact.id
        ? ArtifactRefSchema.parse({
            ...artifact,
            metadata: {
              ...legacyMetadata,
              adapter: "visual-repair-lineage-v1",
            },
          })
        : artifact,
    );
    legacyCandidateRun.revision += 1;
    legacyCandidateRun.updatedAt = new Date().toISOString();
    await store.save(legacyCandidateRun, legacyCandidateRun.revision - 1);
    const legacyRepair = (await service.status({ runId: started.runId })).nextActions.find(
      (action) => action.kind === "implementation-repair",
    );
    expect(legacyRepair).toMatchObject({ repairEvidenceVersion: "legacy-v1" });
    expect(legacyRepair).not.toHaveProperty("repairEvidenceArtifactId");
    const legacyRun = await store.get(started.runId);
    legacyRun.artifacts = legacyRun.artifacts.map((artifact) =>
      artifact.id === originalRepairEvidenceArtifact.id ? originalRepairEvidenceArtifact : artifact,
    );
    legacyRun.revision += 1;
    legacyRun.updatedAt = new Date().toISOString();
    await store.save(legacyRun, legacyRun.revision - 1);
    expect(afterFirstFailure.nextActions.map((action) => action.kind)).not.toContain(
      "compare-visuals",
    );

    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'repair-1';\n");
    const repairedOnce = await service.submit({
      runId: started.runId,
      submission: implementationSubmission,
    });
    const compareSecond = repairedOnce.nextActions.find(
      (action) => action.kind === "compare-visuals",
    );
    if (compareSecond === undefined || !("reviewPacketId" in compareSecond)) {
      throw new Error("Missing second visual comparison action");
    }
    expect(compareSecond.attempt).toBe(2);
    const secondAttempt = await visualSubmission(
      compareSecond,
      await packetHeadFor(compareSecond.reviewPacketId),
      "attempt-2",
      [192, 192, 192, 255],
    );
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          ...secondAttempt,
          captures: secondAttempt.captures.slice(0, 1),
          artifactPaths: secondAttempt.artifactPaths.slice(0, 2),
        },
      }),
    ).rejects.toThrow(/missing: checkout-summary/);
    const afterSecondFailure = await service.submit({
      runId: started.runId,
      submission: secondAttempt,
    });
    expect(
      afterSecondFailure.nextActions.find((action) => action.kind === "implementation-repair"),
    ).toMatchObject({ nextAttempt: 3, lineageId: firstRepair?.lineageId });

    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'repair-2';\n");
    const repairedTwice = await service.submit({
      runId: started.runId,
      submission: implementationSubmission,
    });
    const compareThird = repairedTwice.nextActions.find(
      (action) => action.kind === "compare-visuals",
    );
    if (compareThird === undefined || !("reviewPacketId" in compareThird)) {
      throw new Error("Missing third visual comparison action");
    }
    expect(compareThird.attempt).toBe(3);
    const thirdPacketHead = await packetHeadFor(compareThird.reviewPacketId);
    const thirdAttempt = await visualSubmission(
      compareThird,
      thirdPacketHead,
      "attempt-3",
      [128, 128, 128, 255],
    );
    const beforeThirdFailure = await store.get(started.runId);
    const afterThirdFailure = await service.submit({
      runId: started.runId,
      submission: thirdAttempt,
    });
    expect(afterThirdFailure.revision).toBe(beforeThirdFailure.revision + 2);
    expect(afterThirdFailure.status).toBe("blocked");
    expect(afterThirdFailure.blockerDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "implementation",
          code: "VISUAL_REVIEW_THRESHOLD_NOT_MET",
          kind: "verification",
          retryable: false,
          exactUnblockAction:
            "Inspect the failed 92% visual comparison in the draft, correct the implementation or evidence source, and start a new approved Run for further work.",
        }),
      ]),
    );
    expect(
      afterThirdFailure.nextActions
        .map((action) => action.kind)
        .filter((kind) =>
          [
            "compare-visuals",
            "implementation-repair",
            "review-functional",
            "review-design",
          ].includes(kind),
        ),
    ).toEqual([]);
    const beforeReplay = await store.get(started.runId);
    const replayedThirdFailure = await service.submit({
      runId: started.runId,
      submission: thirdAttempt,
    });
    const terminalAfterReplay = await store.get(started.runId);
    expect(replayedThirdFailure.revision).toBe(beforeReplay.revision);
    expect(terminalAfterReplay.revision).toBe(beforeReplay.revision);
    expect(terminalAfterReplay.artifacts).toEqual(beforeReplay.artifacts);

    const run = await store.get(started.runId);
    const reports = run.artifacts.filter((artifact) => artifact.kind === "visual-report");
    expect(reports).toHaveLength(3);
    expect(
      run.artifacts.filter(
        (artifact) =>
          artifact.metadata["visualRole"] === "baseline-normalized" ||
          artifact.metadata["visualRole"] === "actual-normalized",
      ),
    ).toHaveLength(12);
    expect(
      reports.every(
        (artifact) =>
          artifact.metadata["visualLineageId"] === firstRepair?.lineageId &&
          artifact.metadata["visualStatus"] === "failed",
      ),
    ).toBe(true);
    const thirdReport = reports.find(
      (artifact) => artifact.metadata["visualComparisonAttempt"] === 3,
    );
    if (thirdReport === undefined) throw new Error("Missing third visual report");
    const terminalIdentity = `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          runId: started.runId,
          lineageId: firstRepair?.lineageId,
          reviewPacketId: compareThird.reviewPacketId,
          attempt: 3,
          visualReportDigest: thirdReport.digest,
        }),
      )
      .digest("hex")}`;
    const implementationStage = run.stages.find((item) => item.name === "implementation");
    expect(implementationStage).toMatchObject({
      status: "failed",
      checkpoint: {
        name: "visual-threshold-not-met",
        data: {
          visualTerminalIdentity: terminalIdentity,
          visualReportArtifactId: thirdReport.id,
          visualReportDigest: thirdReport.digest,
        },
      },
    });
    const terminalArtifactIds = run.artifacts
      .filter(
        (artifact) =>
          artifact.id === thirdReport.id ||
          (artifact.metadata["visualComparisonAttempt"] === 3 &&
            (artifact.metadata["reservationStatus"] === "committed" ||
              artifact.metadata["visualRole"] !== undefined)) ||
          (artifact.metadata["visualLineageAttempt"] === 3 &&
            artifact.metadata["visualLineageStatus"] === "exhausted"),
      )
      .map((artifact) => artifact.id);
    expect(implementationStage?.artifactIds).toEqual(expect.arrayContaining(terminalArtifactIds));
    const lastReport = JSON.parse(
      (await artifactStore.readContent(thirdReport.digest)).toString("utf8"),
    ) as Record<string, unknown>;
    expect(lastReport).toMatchObject({
      attempt: 3,
      status: "failed",
      reviewPacketId: compareThird.reviewPacketId,
      visualLineageId: firstRepair?.lineageId,
      results: expect.arrayContaining([
        expect.objectContaining({
          targetId: "checkout-default",
          metrics: expect.objectContaining({ reviewMatchRatio: 0, threshold: 0.92 }),
        }),
      ]),
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "design-review",
          reviewPacketId: compareThird.reviewPacketId,
          verdict: "approved",
          summary: "Caller claims the design passed.",
          requirements: [{ id: "figma-screen", verdict: "accepted" }],
          artifactPaths: ["visual/diff.png"],
          gateResults: [
            { id: "visual", status: "passed", evidencePaths: ["visual/diff.png"] },
            {
              id: "accessibility",
              status: "passed",
              evidencePaths: ["visual/diff.png"],
            },
          ],
        },
      }),
    ).rejects.toThrow(/VISUAL_ATTEMPT_LIMIT_REACHED/);

    const diagnosticReport = await service.ensureBlockedDiagnosticReport({
      runId: started.runId,
    });
    expect(diagnosticReport.metadata["idempotencyKey"]).toBe(
      `implementation:VISUAL_REVIEW_THRESHOLD_NOT_MET:${terminalIdentity}`,
    );
    const runWithDiagnostic = await store.get(started.runId);
    const diagnosticJsonArtifact = runWithDiagnostic.artifacts.find(
      (artifact) => artifact.id === diagnosticReport.metadata["reportJsonArtifactId"],
    );
    if (diagnosticJsonArtifact === undefined) {
      throw new Error("Missing canonical blocked diagnostic JSON");
    }
    const diagnosticJson = JSON.parse(
      (await artifactStore.readContent(diagnosticJsonArtifact.digest)).toString("utf8"),
    ) as Record<string, unknown>;
    expect(diagnosticJson).toMatchObject({
      schemaVersion: "pr-report-v2.1",
      runId: started.runId,
      decision: "blocked",
      binding: {
        reviewPacketId: compareThird.reviewPacketId,
        headSha: thirdPacketHead,
        diffDigest: expect.stringMatching(/^sha256:/),
      },
      visual: {
        applicable: true,
        reportArtifactId: thirdReport.id,
        attempt: 3,
        status: "failed",
        results: expect.arrayContaining([
          expect.objectContaining({
            targetId: "checkout-default",
            status: "failed",
            metrics: expect.objectContaining({ threshold: 0.92 }),
          }),
        ]),
      },
    });
    expect(diagnosticReport.metadata).toMatchObject({
      locale: "ko",
      reviewPacketId: compareThird.reviewPacketId,
      headSha: thirdPacketHead,
      diffDigest: (diagnosticJson["binding"] as Record<string, unknown>)["diffDigest"],
      visualReportArtifactId: thirdReport.id,
    });
    expect(diagnosticJsonArtifact.metadata).toMatchObject({
      reviewPacketId: compareThird.reviewPacketId,
      headSha: thirdPacketHead,
      diffDigest: (diagnosticJson["binding"] as Record<string, unknown>)["diffDigest"],
      visualReportArtifactId: thirdReport.id,
    });
    const revisionWithDiagnostic = (await store.get(started.runId)).revision;
    const replayedDiagnosticReport = await service.ensureBlockedDiagnosticReport({
      runId: started.runId,
    });
    expect(replayedDiagnosticReport.id).toBe(diagnosticReport.id);
    expect((await store.get(started.runId)).revision).toBe(revisionWithDiagnostic);
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
        requirementManifest: requirements("checkout-api-ui"),
      },
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "UI claimed API readiness without checkpoint evidence.",
          apiReady: true,
          uiChanged: true,
          changedFiles: ["src/checkout.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow("api-ready");

    await writeFile(path.join(directory, "generated/mock.ts"), "", "utf8");
    await expect(submitApiReady(service, started.runId)).rejects.toThrow(/empty/i);
    await writeFile(path.join(directory, "generated/mock.ts"), "export const mock = {};\n", "utf8");

    const apiReady = await submitApiReady(service, started.runId);
    expect(apiReady.stages.find((item) => item.name === "implementation")).toMatchObject({
      status: "pending",
      checkpoint: "api-ready",
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "A different implementation context tried to finish the UI.",
          apiReady: true,
          implementationContextId: "ctx_different_02",
          uiChanged: true,
          changedFiles: ["src/checkout.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow(/context/i);

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

  it("accepts a passing Vitest JSON report as API contract evidence", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement a checkout UI backed by an API",
      scope: "ui",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "API and UI contracts are ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout-api-ui"),
      },
    });
    await writeFile(
      path.join(directory, "test-results/api-contract.json"),
      JSON.stringify({
        success: true,
        numFailedTestSuites: 0,
        numFailedTests: 0,
        numPassedTests: 3,
        numTotalTests: 3,
      }),
      "utf8",
    );

    const apiReady = await submitApiReady(service, started.runId);

    expect(apiReady.stages.find((item) => item.name === "implementation")).toMatchObject({
      status: "pending",
      checkpoint: "api-ready",
    });
  });

  it("rejects API-ready categories that alias one physical file", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement a checkout UI backed by an API",
      scope: "ui",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "API and UI contracts are ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout-api-ui"),
      },
    });

    const aliases = ["type.ts", "schema.ts", "wrapper.ts", "mock.ts", "contract.json"];
    await mkdir(path.join(directory, "aliases"), { recursive: true });
    for (const alias of aliases) {
      await link(path.join(directory, "generated/api.ts"), path.join(directory, "aliases", alias));
    }

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "api-ready",
          status: "passed",
          summary: "The same file is disguised as five API artifacts.",
          implementationContextId: "ctx_checkout_01",
          artifactPaths: aliases.map((item) => `aliases/${item}`),
          apiArtifacts: {
            types: ["aliases/type.ts"],
            schemas: ["aliases/schema.ts"],
            wrappers: ["aliases/wrapper.ts"],
            mocks: ["aliases/mock.ts"],
            contractTests: ["aliases/contract.json"],
          },
        },
      }),
    ).rejects.toThrow(/distinct physical evidence files/i);
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
        requirementManifest: [
          {
            id: "checkout-states",
            title: "Checkout | states",
            acceptanceCriteria: ["Empty | loading\nSuccess states render."],
          },
          ...requirements("checkout-submit"),
        ],
        workloadSignals: {
          requirements: 18,
          relevantFiles: 35,
          apiOperations: 10,
          uiSurfaces: 8,
          figmaNodes: 40,
          testTargets: 12,
          uncertainty: 0,
        },
      },
    });
    await submitApiReady(service, started.runId);
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'api-backed';\n");
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "API-backed UI implemented.",
        apiReady: true,
        implementationContextId: "ctx_checkout_01",
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
        reviewPacketId: reviewPacketId(implemented, "review-design"),
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
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
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

    await changeSource(directory, "src/checkout.tsx", "mutated after approvals\n");
    await expect(service.advance({ runId: started.runId, until: "publish-ready" })).rejects.toThrow(
      /packet.*stale|diff.*match/i,
    );
    await changeSource(directory, "src/checkout.tsx", "export const checkout = 'api-backed';\n");

    const ready = await service.advance({ runId: started.runId, until: "publish-ready" });

    expect(ready.status).toBe("publish-ready");
    expect(ready.currentStage).toBe("publish");
    expect(ready.resumeContext.evidencePaths.length).toBeGreaterThanOrEqual(4);
    const report = await reportMarkdown(store, artifactStore, started.runId);
    expect(report).toContain("| Checkout \\| states | 디자인 승인 |");
    expect(report).toContain("| checkout submit | 기능 승인 |");
    expect(report).not.toContain("checkout-states: 요구사항");
    expect(report).not.toContain("checkout-submit: 요구사항");
    expect(report).toContain("src/checkout.tsx");
    expect(report).toMatch(/변경 해시 \| sha256:[a-f0-9]{64} \|/);
    expect(report).toContain("| 기능 리뷰 | 승인 | 1/1 통과 | 0건 |");
    expect(report).toContain("| 디자인·접근성 리뷰 | 승인 | 1/1 통과 | 0건 |");
    expect(report).not.toContain("## API");
    expect(report).not.toContain("## 레거시 이관");
    expect(report).not.toContain("## 화면 일치율");
    expect(report).not.toContain("Gates: &#91;");
    expect(report).not.toContain("Findings: &#91;");
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
        requirementManifest: requirements("parser"),
      },
    });
    expect(contracted.nextActions).toEqual([
      { kind: "implement", runId: started.runId, requireApiReady: false },
    ]);
    await changeSource(directory, "src/parser.ts", "export const parser = 'refactored';\n");
    const implemented = await service.submit({
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
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
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

  it("completes after report when draft publication was not requested", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser without publishing",
      scope: "non-ui",
      publication: "none",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Requirements normalized.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("parser"),
      },
    });
    await changeSource(directory, "src/parser.ts", "export const parser = 'no-publish';\n");
    const implemented = await service.submit({
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
        reviewPacketId: reviewPacketId(implemented, "review-functional"),
        verdict: "approved",
        summary: "Focused test passed.",
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

    const completed = await service.advance({ runId: started.runId, until: "publish-ready" });

    expect(completed.status).toBe("completed");
    expect(completed.nextActions).toEqual([]);
    expect(completed.stages.find((item) => item.name === "publish")?.status).toBe("skipped");

    const publish = vi.fn();
    service = new WorkflowService({
      ...dependencies,
      publisherService: { publish } as unknown as PublisherService,
    });
    await expect(service.publish(publishInput(started.runId))).rejects.toThrow(
      /publication was not requested/i,
    );
    expect(publish).not.toHaveBeenCalled();
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
          requirementManifest: requirements("parser"),
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
          requirementManifest: requirements("parser"),
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
        requirementManifest: requirements("parser"),
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
        requirementManifest: requirements("tracing"),
      },
    });
    await changeSource(directory, "src/tracing.ts", "export const tracing = true;\n");
    const implemented = await service.submit({
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
          reviewPacketId: reviewPacketId(implemented, "review-functional"),
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
      name: "non-draft publication",
      result: {
        status: "passed" as const,
        requestSynced: true,
        request: {
          host: "github" as const,
          url: "https://github.com/acme/spec-to-pr/pull/123",
          number: "123",
          draft: false,
          sourceBranch: "codex/fast-workflow-v2",
          targetBranch: "main",
          created: false,
          updated: true,
        },
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        partialReasons: [],
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
    {
      name: "publication precondition",
      result: {
        status: "blocked" as const,
        requestSynced: false,
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        partialReasons: ["publication precondition is unmet"],
        errorCode: "PUBLISH_PRECONDITION",
        errorMessage: "publication precondition is unmet",
        retryable: false,
      },
      expectedCode: "PUBLISH_PRECONDITION",
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
        status: { status: string; blockerDetails: Array<{ stage: string; kind: string }> };
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
      expect(response.status.blockerDetails).toEqual([
        expect.objectContaining({ stage: "publish", kind: "publish-precondition" }),
      ]);
      expect(run.stages.find((item) => item.name === "archive")?.status).toBe("pending");
    },
  );

  it.each([
    "AWS_SECRET_ACCESS_KEY_IDENTIFIER_SHAPED_SECRET",
    "SECRET_PUBLISH_PROVIDER_CREDENTIAL_IDENTIFIER",
  ])("does not expose untrusted publisher error code %s in status", async (untrustedCode) => {
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
            status: "blocked",
            requestSynced: false,
            visualPreviewExpected: false,
            visualPreviewSynced: false,
            fallbackMode: "none",
            partialReasons: ["provider rejected publication"],
            errorCode: untrustedCode,
            errorMessage: "provider rejected publication",
            publishedAssets: [],
            retryable: false,
            publishedAt: new Date().toISOString(),
          },
          publishResultArtifactId: reportArtifactId,
        }),
      } as unknown as PublisherService,
    });

    const response = (await service.publish(publishInput(runId))) as {
      status: { blockerDetails: Array<{ stage: string; code: string; kind: string }> };
    };
    expect(response.status.blockerDetails).toEqual([
      expect.objectContaining({
        stage: "publish",
        code: "PUBLISH_PRECONDITION",
        kind: "publish-precondition",
      }),
    ]);
    expect(JSON.stringify(response.status.blockerDetails)).not.toContain(untrustedCode);
  });

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
            request: {
              host: "github",
              url: "https://github.com/acme/spec-to-pr/pull/123",
              number: "123",
              draft: true,
              sourceBranch: "codex/fast-workflow-v2",
              targetBranch: "main",
              created: true,
              updated: false,
            },
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
              request: {
                host: "github",
                url: "https://github.com/acme/spec-to-pr/pull/123",
                number: "123",
                draft: true,
                sourceBranch: "codex/fast-workflow-v2",
                targetBranch: "main",
                created: true,
                updated: false,
              },
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
    const status = await service.status({ runId });
    expect(status.blockerDetails).toEqual([
      expect.objectContaining({
        stage: "publish",
        code: "PUBLISH_UNEXPECTED_ERROR",
        kind: "unexpected",
      }),
    ]);
    expect(JSON.stringify(status.blockerDetails)).not.toContain("publisher transport crashed");
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
      requirementManifest: requirements("parser"),
    },
  });
  await writeFile(path.join(projectRoot, "src/parser.ts"), "export const parser = 'publish';\n");
  const implemented = await service.submit({
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
      reviewPacketId: reviewPacketId(implemented, "review-functional"),
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

async function prepareBlockedWorkflow(service: WorkflowService, projectRoot: string) {
  const started = await service.start({
    projectRoot,
    requestText: "Prepare contracts that need an approval",
    scope: "non-ui",
    publication: "draft",
  });
  const blocked = await service.submit({
    runId: started.runId,
    submission: {
      kind: "contracts",
      status: "blocked",
      summary: "Approval is missing.",
      blocker: {
        stage: "contracts",
        code: "MISSING_APPROVAL",
        kind: "missing-input",
        summary: "Approval is missing.",
        retryable: false,
        resumable: true,
        completedWork: [],
        evidencePaths: [],
        attemptedRecovery: [],
        unrunValidations: ["functional"],
        exactUnblockAction: "Provide approval.",
      },
    },
  });
  return { runId: started.runId, blocked };
}

async function appendPublishResultArtifact(
  store: SqliteRunStore,
  artifactStore: ArtifactBlobStore,
  runId: string,
  result: unknown,
) {
  const run = await store.get(runId);
  const timestamp = new Date(Date.parse(run.updatedAt) + 1_000).toISOString();
  const blob = await artifactStore.writeBlob({
    content: Buffer.from(`${JSON.stringify(result)}\n`, "utf8"),
    mediaType: "application/json",
    storedAt: timestamp,
    label: "publish-result",
  });
  const artifact = ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: "agent-result-report",
    uri: blob.uri,
    mediaType: "application/json",
    digest: blob.digest,
    producedBy: "pr-publisher",
    evidenceIds: [],
    createdAt: timestamp,
    metadata: {
      adapter: "publisher-v1",
      label: "publish-result",
      reportKind: "publish-result",
    },
  });
  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    },
    run.revision,
  );
  return artifact.id;
}

async function submitApiReady(service: WorkflowService, runId: string) {
  return service.submit({
    runId,
    submission: {
      kind: "api-ready",
      status: "passed",
      summary: "API types, schemas, wrappers, mocks, and contract tests are ready.",
      implementationContextId: "ctx_checkout_01",
      artifactPaths: [
        "generated/api.ts",
        "generated/schema.ts",
        "generated/wrapper.ts",
        "generated/mock.ts",
        "test-results/api-contract.json",
      ],
      apiArtifacts: {
        types: ["generated/api.ts"],
        schemas: ["generated/schema.ts"],
        wrappers: ["generated/wrapper.ts"],
        mocks: ["generated/mock.ts"],
        contractTests: ["test-results/api-contract.json"],
      },
      operations: checkoutApiReadyOperations(),
    },
  });
}

function checkoutApiReadyOperations() {
  return [
    {
      operationKey: "POST /checkout",
      method: "POST" as const,
      path: "/checkout",
      operationId: "checkout",
      requestTypes: ["CheckoutRequest"],
      responseTypes: ["CheckoutResponse"],
      schemaRefs: ["#/components/schemas/CheckoutRequest"],
      clientSymbols: ["generated/wrapper.ts#checkout"],
      mockHandlers: ["generated/mock.ts#checkout"],
      contractEvidencePaths: ["test-results/api-contract.json"],
      readiness: "contract-tested" as const,
      blocking: false,
    },
  ];
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

function figmaManifest() {
  return {
    provider: "host-connected-figma" as const,
    capturedAt: "2026-07-13T00:00:00.000Z",
    fileUrl: FIGMA_URL,
    fileUrls: [FIGMA_URL],
    nodeIds: ["1:2"],
    capturedComponents: figmaCapturedComponents(),
    designMapping: figmaDesignMapping(),
    visualPaths: ["visual/diff.png"],
    stateContracts: figmaStateContracts(),
    visualTargets: figmaVisualTargets(),
  };
}

function figmaCapturedComponents() {
  return [];
}

function figmaDesignMapping() {
  return {
    designSystem: {
      packageName: "@frontend/ui",
      packageVersion: "1.2.3",
      guidanceSkill: "design-system",
    },
    components: [],
    fonts: [],
    tokens: [],
  };
}

function figmaVisualTargets() {
  return [
    {
      targetId: "checkout-default",
      name: "Checkout",
      state: "default",
      route: "/checkout",
      baselineKind: "figma" as const,
      baselinePath: "visual/diff.png",
      viewport: { width: 1, height: 1 },
      deviceScaleFactor: 1,
      fixture: "mock:checkout",
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
    },
  ];
}

function figmaStateContracts(
  overrides: Partial<{
    targetId: string;
    nodeId: string;
    state: string;
    fixtureId: string;
  }> = {},
) {
  const contractState = overrides.state ?? "default";
  const isAvailable = contractState === "default" || contractState === "available";
  const fields = {
    targetId: "checkout-default",
    nodeId: "1:2",
    state: contractState,
    fixtureId: "mock:checkout",
    facts: [
      {
        id: "cinema",
        kind: "variant" as const,
        subject: "CINEMA 4K",
        value: isAvailable ? "available" : contractState,
      },
      {
        id: "money",
        kind: "visibility" as const,
        subject: "G패스 머니",
        value: isAvailable,
      },
      {
        id: "parking",
        kind: "text" as const,
        subject: "주차",
        value: isAvailable ? "가능" : "불가",
      },
    ],
    requiredAssertionIds: [`assert-checkout-${contractState}`],
    ...overrides,
  };
  return [{ ...fields, digest: figmaStateFactsDigest(fields) }];
}

function requirements(...ids: string[]) {
  return ids.map((id) => ({
    id,
    title: id.replaceAll("-", " "),
    acceptanceCriteria: [`${id} satisfies the declared behavior.`],
  }));
}

function projectRelativePathOfLength(length: number): string {
  const segments: string[] = [];
  let remaining = length;
  while (remaining > 200) {
    segments.push("p".repeat(200));
    remaining -= 201;
  }
  segments.push("p".repeat(remaining));
  const result = segments.join(path.sep);
  if (result.length !== length) throw new Error(`Could not build a ${length}-character path`);
  return result;
}

async function prepareStrictWorkspace(projectRoot: string): Promise<{ releaseQaSha: string }> {
  await execFileAsync("git", ["switch", "-c", "release-qa"], { cwd: projectRoot });
  await mkdir(path.join(projectRoot, "src/pages/shop"), { recursive: true });
  await writeFile(path.join(projectRoot, "src/pages/shop/App.ts"), "export const shop = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd: projectRoot });
  await execFileAsync("git", ["commit", "-qm", "release qa fixture"], { cwd: projectRoot });
  const releaseQaSha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" })
  ).stdout.trim();
  await execFileAsync("git", ["switch", "-c", "codex/shop"], { cwd: projectRoot });
  await execFileAsync("git", ["remote", "add", "origin", "git@gitlab.com:example/mobydick.git"], {
    cwd: projectRoot,
  });
  return { releaseQaSha };
}

async function changeSource(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  await writeFile(path.join(projectRoot, relativePath), content, "utf8");
}

function reviewPacketId(
  status: Awaited<ReturnType<WorkflowService["status"]>>,
  kind: "review-functional" | "review-design",
): string {
  const action = status.nextActions.find((item) => item.kind === kind);
  if (action === undefined || !("reviewPacketId" in action)) {
    throw new Error(`Missing ${kind} packet`);
  }
  return action.reviewPacketId;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function reportMarkdown(
  store: SqliteRunStore,
  artifactStore: ArtifactBlobStore,
  runId: string,
): Promise<string> {
  const run = await store.get(runId);
  const artifact = [...run.artifacts]
    .reverse()
    .find(
      (item) => item.kind === "pr-report" && item.metadata["reportKind"] === "pr-body-markdown",
    );
  if (artifact === undefined) throw new Error("Missing PR report");
  return (await artifactStore.readContent(artifact.digest)).toString("utf8");
}

function validMp4(): Buffer {
  const box = (type: string, payload: Buffer) => {
    const output = Buffer.alloc(8 + payload.length);
    output.writeUInt32BE(output.length, 0);
    output.write(type, 4, 4, "ascii");
    payload.copy(output, 8);
    return output;
  };
  const movieHeader = Buffer.alloc(24);
  movieHeader.writeUInt32BE(1_000, 12);
  movieHeader.writeUInt32BE(1_000, 16);
  return Buffer.concat([
    box("ftyp", Buffer.from("isom\0\0\0\0isom", "binary")),
    box("moov", Buffer.concat([box("mvhd", movieHeader), box("trak", Buffer.alloc(8))])),
    box("mdat", Buffer.alloc(32, 1)),
  ]);
}

function minimalTextPdf(text: string): Buffer {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = "BT /F1 12 Tf 72 720 Td (" + escaped + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      String(Buffer.byteLength(stream, "latin1")) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += String(index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += "xref\n0 " + String(objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    body += String(offset).padStart(10, "0") + " 00000 n \n";
  });
  body +=
    "trailer\n<< /Size " +
    String(objects.length + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    String(xrefOffset) +
    "\n%%EOF\n";
  return Buffer.from(body, "latin1");
}

class WorkflowFakePublisher implements ReviewRequestPublisher {
  public readonly createdPayloads: ReviewRequestPayload[] = [];
  public readonly updatedMetadata: ReviewRequestUpdate[] = [];
  private existingRequest: PublishedReviewRequest | undefined;

  public constructor(private readonly createGate?: Promise<void>) {}

  public async findExisting(): Promise<PublishedReviewRequest | undefined> {
    return this.existingRequest;
  }

  public async publishAssets() {
    return [];
  }

  public async create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest> {
    this.createdPayloads.push(input.payload);
    await this.createGate;
    const request = {
      host: "github",
      url: "https://github.com/acme/spec-to-pr/pull/123",
      number: "123",
      id: "123",
      draft: true,
      sourceBranch: input.payload.sourceBranch,
      targetBranch: input.payload.targetBranch,
      created: true,
      updated: false,
    } satisfies PublishedReviewRequest;
    this.existingRequest = { ...request, created: false };
    return request;
  }

  public async update(input: {
    target: PublishTarget;
    requestNumber: string;
    update: ReviewRequestUpdate;
    token: string;
  }): Promise<PublishedReviewRequest> {
    this.updatedMetadata.push(input.update);
    const request = {
      host: "github",
      url: `https://github.com/acme/spec-to-pr/pull/${input.requestNumber}`,
      number: input.requestNumber,
      id: input.requestNumber,
      draft: true,
      sourceBranch: "codex/blocked-diagnostic",
      targetBranch: "main",
      created: false,
      updated: true,
    } satisfies PublishedReviewRequest;
    this.existingRequest = { ...request, updated: false };
    return request;
  }
}
