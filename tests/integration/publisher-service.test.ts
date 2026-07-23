import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { PublisherService } from "../../src/application/publisher-service.js";
import { RunService } from "../../src/application/run-service.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import type {
  PublishedReviewRequest,
  PublishTarget,
  ReviewRequestPayload,
  ReviewRequestPublisher,
  ReviewRequestUpdate,
} from "../../src/publisher/index.js";
import { GitHubPublisherAdapter } from "../../src/publisher/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";
import type { RunStore } from "../../src/store/run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let runService: RunService;
let prReportService: {
  generatePrReport: typeof generatePrReport;
  getPrReport: typeof getPrReport;
};
let publisherService: PublisherService;
let originalGithubToken: string | undefined;
let githubPublisher: FakePublisher;
let gitlabPublisher: FakePublisher;
let gitCalls: string[][];
let gitCurrentBranch: string;
const gitHead = "a".repeat(40);

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-publisher-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });

  originalGithubToken = process.env["GITHUB_TOKEN"];
  process.env["GITHUB_TOKEN"] = "ghp_test_token";

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));

  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  prReportService = { generatePrReport, getPrReport };
  githubPublisher = new FakePublisher("github");
  gitlabPublisher = new FakePublisher("gitlab");
  gitCalls = [];
  gitCurrentBranch = "spec-to-pr/run-1";
  publisherService = new PublisherService(
    store,
    artifactStore,
    () => "2026-06-23T00:00:02.000Z",
    {
      github: githubPublisher,
      gitlab: gitlabPublisher,
    },
    async (_cwd, args) => {
      gitCalls.push(args);
      if (args[0] === "status") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-list") {
        return { stdout: "1\n", stderr: "" };
      }
      if (args[0] === "symbolic-ref") {
        return { stdout: `${gitCurrentBranch}\n`, stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: `${gitHead}\n`, stderr: "" };
      }
      return {
        stdout: "https://github.com/acme/spec-to-pr.git\n",
        stderr: "",
      };
    },
  );
});

afterEach(async () => {
  if (originalGithubToken === undefined) {
    delete process.env["GITHUB_TOKEN"];
  } else {
    process.env["GITHUB_TOKEN"] = originalGithubToken;
  }

  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("PublisherService", () => {
  it("rejects a lookalike remote before any provider request", async () => {
    const previousHostOverride = process.env["SPEC_TO_PR_GIT_HOST"];
    delete process.env["SPEC_TO_PR_GIT_HOST"];
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const fetchMock = vi.fn();
    const lookalikeService = new PublisherService(
      store,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      { github: new GitHubPublisherAdapter(fetchMock), gitlab: gitlabPublisher },
      async (_cwd, args) => {
        if (args[0] === "status") return { stdout: "", stderr: "" };
        if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
        if (args[0] === "symbolic-ref") {
          return { stdout: "spec-to-pr/run-1\n", stderr: "" };
        }
        if (args[0] === "rev-parse") return { stdout: `${gitHead}\n`, stderr: "" };
        return { stdout: "https://github.attacker.test/acme/spec-to-pr.git\n", stderr: "" };
      },
    );

    try {
      await expect(
        lookalikeService.publish({
          runId: run.id,
          reportArtifactId: report.markdownArtifactId,
          sourceBranch: "spec-to-pr/run-1",
          targetBranch: "main",
          pushBranch: false,
          confirm: true,
        }),
      ).rejects.toThrow(/Unsupported Git remote host/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(githubPublisher.createdPayloads).toHaveLength(0);
    } finally {
      if (previousHostOverride === undefined) delete process.env["SPEC_TO_PR_GIT_HOST"];
      else process.env["SPEC_TO_PR_GIT_HOST"] = previousHostOverride;
    }
  });

  it("retries publish-result persistence after a concurrent Run revision", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    let injectedConflict = false;
    const conflictingStore: RunStore = {
      create: (manifest) => store.create(manifest),
      get: (runId) => store.get(runId),
      list: (filter) => store.list(filter),
      close: async () => {},
      save: async (manifest, expectedRevision) => {
        if (
          !injectedConflict &&
          manifest.artifacts.some(
            (artifact) => artifact.metadata["reportKind"] === "publish-result",
          )
        ) {
          injectedConflict = true;
          const current = await store.get(manifest.id);
          await store.save(
            {
              ...current,
              revision: current.revision + 1,
              updatedAt: "2026-06-23T00:00:01.500Z",
            },
            current.revision,
          );
        }
        return store.save(manifest, expectedRevision);
      },
    };
    const concurrentPublisherService = new PublisherService(
      conflictingStore,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      { github: githubPublisher, gitlab: gitlabPublisher },
      async (_cwd, args) => {
        if (args[0] === "status") return { stdout: "", stderr: "" };
        if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
        if (args[0] === "symbolic-ref") {
          return { stdout: "spec-to-pr/run-1\n", stderr: "" };
        }
        if (args[0] === "rev-parse") return { stdout: `${gitHead}\n`, stderr: "" };
        return { stdout: "https://github.com/acme/spec-to-pr.git\n", stderr: "" };
      },
    );

    const published = await concurrentPublisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(injectedConflict).toBe(true);
    expect(githubPublisher.createdPayloads).toHaveLength(1);
    expect(
      (await store.get(run.id)).artifacts.filter(
        (artifact) => artifact.metadata["reportKind"] === "publish-result",
      ),
    ).toHaveLength(1);
    expect(published.publishResultArtifactId).toMatch(/^art_/);
  });

  it("plans publishes records result and stores publisher review", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);

    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    expect(report.decision).toBe("ready");

    const reportBody = await prReportService.getPrReport({
      runId: run.id,
      artifactId: report.markdownArtifactId,
    });

    const plan = await publisherService.plan({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
    });

    expect(plan.target).toMatchObject({
      host: "github",
      owner: "acme",
      repo: "spec-to-pr",
    });
    expect(plan.payload.mode).toBe("draft");
    expect(plan.intent).toBe("ready");
    expect(plan.payload.body).toBe(reportBody.markdown);

    const controller = new AbortController();
    const published = await publisherService.publish(
      {
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        pushBranch: false,
        confirm: true,
      },
      { signal: controller.signal },
    );

    expect(published.result).toMatchObject({
      status: "passed",
      requestSynced: true,
      visualPreviewExpected: true,
      visualPreviewSynced: true,
      fallbackMode: "none",
      partialReasons: [],
      request: {
        url: "https://github.com/acme/spec-to-pr/pull/123",
        draft: true,
      },
    });
    expect(published.agentResultId).toMatch(/^ar_/);
    expect(githubPublisher.receivedSignals).toContain(controller.signal);
    expect(githubPublisher.createdPayloads[0]?.body).toContain("## 시각 증거 미리보기");
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/figma.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/browser.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain(
      "https://github.example/assets/diff.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain(
      "art_22222222222222222222222222222222",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("Artifact IDs");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("# 요약");
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("내부 audit 요약");
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("Run ID");
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("## 실행 메타데이터");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("## 결정");

    const loadedResult = await publisherService.getResult({
      runId: run.id,
      artifactId: published.publishResultArtifactId,
    });

    expect(loadedResult.result.status).toBe("passed");
    expect(loadedResult.result.requestSynced).toBe(true);
    expect(loadedResult.result.visualPreviewSynced).toBe(true);

    const review = await publisherService.recordReview({
      runId: run.id,
      publishResultArtifactId: published.publishResultArtifactId,
      review: {
        status: "passed",
        findings: [],
      },
    });

    expect(review.findingCount).toBe(0);

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(true);
  });

  it("uses trusted Korean report metadata for visual evidence even when historical Markdown is English", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    const report = await generatePrReport({
      runId: run.id,
      body: "# Summary\n\n## Decision\n\nReady for draft review.\n",
      metadata: {
        reportKind: "pr-body-markdown",
        reportIntent: "ready",
        decision: "ready",
        locale: "ko",
      },
    });

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(githubPublisher.createdPayloads[0]?.body).toContain("## 시각 증거 미리보기");
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("## Visual Evidence Preview");
  });

  it("pushes the source branch through the selected remote", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });

    gitCurrentBranch = "spec-to-pr/run-upstream";
    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-upstream",
      targetBranch: "main",
      remoteName: "upstream",
      pushBranch: true,
      confirm: true,
    });

    expect(published.result.status).toBe("passed");
    expect(gitCalls).toContainEqual([
      "push",
      "--set-upstream",
      "upstream",
      "spec-to-pr/run-upstream",
    ]);
  });

  it("requires a clean tree and returns a typed result without committed source-branch changes", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const input = {
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "codex/checkout",
      targetBranch: "main",
      pushBranch: true,
      confirm: true,
    } as const;
    const createService = (status: string, ahead: string) =>
      new PublisherService(
        store,
        artifactStore,
        () => "2026-06-23T00:00:02.000Z",
        { github: githubPublisher, gitlab: gitlabPublisher },
        async (_cwd, args) => ({
          stdout:
            args[0] === "status"
              ? status
              : args[0] === "symbolic-ref"
                ? "codex/checkout\n"
                : args[0] === "rev-parse"
                  ? `${gitHead}\n`
                  : args[0] === "rev-list"
                    ? ahead
                    : "https://github.com/acme/spec-to-pr.git\n",
          stderr: "",
        }),
      );

    await expect(createService(" M src/page.tsx\n", "1\n").publish(input)).rejects.toThrow(
      /clean working tree/i,
    );
    await expect(createService("", "0\n").publish(input)).resolves.toMatchObject({
      result: {
        status: "blocked",
        errorCode: "PUBLISH_NO_DELTA",
        requestSynced: false,
      },
    });
  });

  it("binds publication to the checked-out source branch and its exact head", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const sourceSha = "a".repeat(40);
    const mismatchedBranch = new PublisherService(
      store,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      { github: githubPublisher, gitlab: gitlabPublisher },
      async (_cwd, args) => ({
        stdout:
          args[0] === "status"
            ? ""
            : args[0] === "symbolic-ref"
              ? "codex/other\n"
              : args[0] === "rev-parse"
                ? `${sourceSha}\n`
                : args[0] === "rev-list"
                  ? "1\n"
                  : "https://github.com/acme/spec-to-pr.git\n",
        stderr: "",
      }),
    );

    await expect(
      mismatchedBranch.publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        headSha: sourceSha,
        pushBranch: false,
        confirm: true,
      }),
    ).rejects.toThrow(/checked-out branch/i);

    const mismatchedHead = new PublisherService(
      store,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      { github: githubPublisher, gitlab: gitlabPublisher },
      async (_cwd, args) => ({
        stdout:
          args[0] === "status"
            ? ""
            : args[0] === "symbolic-ref"
              ? "codex/checkout\n"
              : args[0] === "rev-parse" && args.at(-1) === "HEAD"
                ? `${sourceSha}\n`
                : args[0] === "rev-parse"
                  ? `${"b".repeat(40)}\n`
                  : args[0] === "rev-list"
                    ? "1\n"
                    : "https://github.com/acme/spec-to-pr.git\n",
        stderr: "",
      }),
    );
    await expect(
      mismatchedHead.publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "codex/checkout",
        targetBranch: "main",
        headSha: sourceSha,
        pushBranch: false,
        confirm: true,
      }),
    ).rejects.toThrow(/does not match source branch/i);
  });

  it("refuses to update an existing non-draft review request", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.existingRequest = {
      host: "github",
      url: "https://github.com/acme/spec-to-pr/pull/123",
      number: "123",
      id: "123",
      draft: false,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      created: false,
      updated: false,
    };

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result.status).toBe("failed");
    expect(published.result.errorMessage).toMatch(/non-draft/i);
    expect(githubPublisher.updatedBodies).toHaveLength(0);
  });

  it("does not report success when the host returns a non-draft request", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.forceNonDraftResult = true;

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result.status).toBe("failed");
    expect(published.result.requestSynced).toBe(false);
    expect(published.result.errorMessage).toMatch(/draft/i);
  });

  it("refuses to publish a blocked report", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    expect(report.decision).toBe("blocked");

    const blocked = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(blocked.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_BLOCKED",
      requestSynced: false,
      visualPreviewExpected: false,
      visualPreviewSynced: false,
    });
    expect(blocked.agentResultId).toBeUndefined();

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
  });

  it("creates a synchronized blocked diagnostic draft without requiring a reviewed head SHA", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await prReportService.generatePrReport({
      runId: run.id,
      metadata: {
        reportKind: "pr-body-markdown",
        reportIntent: "blocked-diagnostic",
        decision: "blocked",
        idempotencyKey: "contracts:0:MISSING_INPUT",
      },
    });

    const plan = await publisherService.plan({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      headSha: "b".repeat(40),
      intent: "blocked-diagnostic",
      pushBranch: false,
    });
    expect(plan).toMatchObject({
      intent: "blocked-diagnostic",
      reportDecision: "blocked",
      willCreateOrUpdate: true,
      payload: {
        title: `[Blocked] SpecToPR Run ${run.id}`,
        labels: ["spec-to-pr", "spec-to-pr:blocked"],
      },
    });

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      headSha: "b".repeat(40),
      intent: "blocked-diagnostic",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result).toMatchObject({
      status: "blocked",
      requestSynced: true,
      request: { number: "123", draft: true, created: true },
    });
    expect(published.result.errorCode).toBeUndefined();
    expect(published.agentResultId).toBeUndefined();
    expect(githubPublisher.createdPayloads[0]).toMatchObject({
      title: `[Blocked] SpecToPR Run ${run.id}`,
      labels: ["spec-to-pr", "spec-to-pr:blocked"],
    });
    expect(gitCalls).toContainEqual(["rev-list", "--count", "main..spec-to-pr/run-1"]);

    const publishedRun = await store.get(run.id);
    const publishResultArtifact = publishedRun.artifacts.find(
      (artifact) => artifact.id === published.publishResultArtifactId,
    );
    expect(publishResultArtifact?.metadata).toMatchObject({
      publishIntent: "blocked-diagnostic",
      diagnosticReportKey: "contracts:0:MISSING_INPUT",
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      remoteName: "origin",
      pushBranch: false,
    });
  });

  it("updates the same source-target diagnostic draft instead of creating another", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await prReportService.generatePrReport({ runId: run.id });
    const input = {
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic" as const,
      pushBranch: false,
      confirm: true as const,
    };

    const first = await publisherService.publish(input);
    githubPublisher.existingRequest = {
      ...first.result.request!,
      created: false,
      updated: false,
    };
    const second = await publisherService.publish(input);

    expect(second.result).toMatchObject({
      status: "blocked",
      requestSynced: true,
      request: { number: "123", created: false, updated: true },
    });
    expect(githubPublisher.createdPayloads).toHaveLength(1);
    expect(githubPublisher.updatedMetadata).toContainEqual({
      title: `[Blocked] SpecToPR Run ${run.id}`,
      body: expect.stringContaining("blocked"),
      labels: ["spec-to-pr", "spec-to-pr:blocked"],
    });
  });

  it("records partial GitHub create and update mutations and completes labels on retry", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await prReportService.generatePrReport({ runId: run.id });
    const pull = {
      html_url: "https://github.com/acme/spec-to-pr/pull/126",
      number: 126,
      id: 459,
      draft: true,
      head: { ref: "spec-to-pr/run-1" },
      base: { ref: "main" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(pull))
      .mockResolvedValueOnce(new Response("labels unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([pull]))
      .mockResolvedValueOnce(jsonResponse(pull))
      .mockResolvedValueOnce(new Response("labels still unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([pull]))
      .mockResolvedValueOnce(jsonResponse(pull))
      .mockResolvedValueOnce(jsonResponse([{ name: "spec-to-pr" }]));
    const realAdapterService = new PublisherService(
      store,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      {
        github: new GitHubPublisherAdapter(fetchMock),
        gitlab: gitlabPublisher,
      },
      async (_cwd, args) => {
        if (args[0] === "status") return { stdout: "", stderr: "" };
        if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
        if (args[0] === "symbolic-ref") {
          return { stdout: "spec-to-pr/run-1\n", stderr: "" };
        }
        if (args[0] === "rev-parse") return { stdout: `${gitHead}\n`, stderr: "" };
        return { stdout: "https://github.com/acme/spec-to-pr.git\n", stderr: "" };
      },
    );
    const input = {
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic" as const,
      pushBranch: false,
      confirm: true as const,
    };

    const partial = await realAdapterService.publish(input);
    expect(partial.result).toMatchObject({
      status: "failed",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      retryable: true,
      requestSynced: false,
      request: {
        number: "126",
        created: true,
        updated: false,
      },
    });
    expect(partial.result.partialReasons.join("\n")).toMatch(/labels.*503/i);
    expect(partial.agentResultId).toBeUndefined();

    const updatePartial = await realAdapterService.publish(input);
    expect(updatePartial.result).toMatchObject({
      status: "failed",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      retryable: true,
      requestSynced: false,
      request: {
        number: "126",
        created: false,
        updated: true,
      },
    });
    expect(updatePartial.result.partialReasons.join("\n")).toMatch(/labels.*503/i);
    expect(updatePartial.agentResultId).toBeUndefined();

    const recovered = await realAdapterService.publish(input);
    expect(recovered.result).toMatchObject({
      status: "blocked",
      requestSynced: true,
      request: {
        number: "126",
        created: false,
        updated: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2);
    expect(JSON.parse(String(fetchMock.mock.calls[8]![1]!.body))).toEqual({
      labels: ["spec-to-pr", "spec-to-pr:blocked"],
    });
  });

  it("marks reviewer partial synchronization non-retryable while preserving the draft", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await prReportService.generatePrReport({ runId: run.id });
    const pull = {
      html_url: "https://github.com/acme/spec-to-pr/pull/127",
      number: 127,
      id: 460,
      draft: true,
      head: { ref: "spec-to-pr/run-1" },
      base: { ref: "main" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(pull))
      .mockResolvedValueOnce(jsonResponse([{ name: "spec-to-pr" }]))
      .mockResolvedValueOnce(new Response("reviewers unavailable", { status: 503 }));
    const realAdapterService = new PublisherService(
      store,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      {
        github: new GitHubPublisherAdapter(fetchMock),
        gitlab: gitlabPublisher,
      },
      async (_cwd, args) => {
        if (args[0] === "status") return { stdout: "", stderr: "" };
        if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
        if (args[0] === "symbolic-ref") {
          return { stdout: "spec-to-pr/run-1\n", stderr: "" };
        }
        if (args[0] === "rev-parse") return { stdout: `${gitHead}\n`, stderr: "" };
        return { stdout: "https://github.com/acme/spec-to-pr.git\n", stderr: "" };
      },
    );

    const partial = await realAdapterService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      reviewers: ["octocat"],
      pushBranch: false,
      confirm: true,
    });

    expect(partial.result).toMatchObject({
      status: "failed",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      retryable: false,
      requestSynced: false,
      request: {
        number: "127",
        created: true,
        updated: false,
      },
    });
    expect(partial.result.partialReasons.join("\n")).toMatch(/reviewers.*503/i);
    expect(partial.agentResultId).toBeUndefined();
  });

  it("recovers a blocked diagnostic by updating the same draft to ready metadata", async () => {
    const run = await runService.createRun({ projectRoot });
    const blockedReport = await prReportService.generatePrReport({ runId: run.id });
    const blocked = await publisherService.publish({
      runId: run.id,
      reportArtifactId: blockedReport.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      pushBranch: false,
      confirm: true,
    });
    githubPublisher.existingRequest = {
      ...blocked.result.request!,
      created: false,
      updated: false,
    };

    await markRunReadyForPublish(run.id);
    const readyReport = await prReportService.generatePrReport({ runId: run.id });
    const ready = await publisherService.publish({
      runId: run.id,
      reportArtifactId: readyReport.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "ready",
      pushBranch: false,
      confirm: true,
    });

    expect(ready.result).toMatchObject({
      status: "passed",
      requestSynced: true,
      request: { number: "123", created: false, updated: true },
    });
    expect(githubPublisher.createdPayloads).toHaveLength(1);
    expect(githubPublisher.updatedMetadata.at(-1)).toEqual({
      title: `spec-to-pr evidence report for ${run.id}`,
      body: expect.stringContaining("ready"),
      labels: ["spec-to-pr"],
    });
  });

  it("returns PUBLISH_NO_DELTA without creating a review request", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await prReportService.generatePrReport({ runId: run.id });
    const noDeltaService = new PublisherService(
      store,
      artifactStore,
      () => "2026-06-23T00:00:02.000Z",
      { github: githubPublisher, gitlab: gitlabPublisher },
      async (_cwd, args) => ({
        stdout:
          args[0] === "status"
            ? ""
            : args[0] === "symbolic-ref"
              ? "spec-to-pr/run-1\n"
              : args[0] === "rev-parse"
                ? `${gitHead}\n`
                : args[0] === "rev-list"
                  ? "0\n"
                  : "https://github.com/acme/spec-to-pr.git\n",
        stderr: "",
      }),
    );

    const published = await noDeltaService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      pushBranch: true,
      confirm: true,
    });

    expect(published.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_NO_DELTA",
      requestSynced: false,
      retryable: false,
    });
    expect(githubPublisher.createdPayloads).toHaveLength(0);
    expect(githubPublisher.updatedMetadata).toHaveLength(0);
  });

  it("does not let compatibility flags mutate a ready report as a blocked diagnostic", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.existingRequest = existingDraftRequest("473");

    const updated = await publisherService.updateBody({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      requestNumber: "473",
      allowBlockedBody: true,
      pushBranch: false,
      confirm: true,
    });

    expect(updated.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_INTENT_MISMATCH",
      requestSynced: false,
    });
    expect(updated.agentResultId).toBeUndefined();
    expect(githubPublisher.updatedMetadata).toHaveLength(0);
  });

  it.each([
    {
      name: "missing",
      metadata: { reportKind: "pr-body-markdown", decision: "blocked" },
    },
    {
      name: "malformed",
      metadata: {
        reportKind: "pr-body-markdown",
        reportIntent: "diagnostic",
        decision: "blocked",
      },
    },
  ])(
    "does not publish $name report metadata through compatibility update",
    async ({ metadata }) => {
      const run = await runService.createRun({ projectRoot });
      const report = await generatePrReport({ runId: run.id, metadata });
      githubPublisher.existingRequest = existingDraftRequest("472");

      const plan = await publisherService.plan({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        intent: "blocked-diagnostic",
        pushBranch: false,
      });
      expect(plan).toMatchObject({
        reportMetadataValid: false,
        reportDecision: "blocked",
        willCreateOrUpdate: false,
      });
      expect(plan.reportIntent).toBeUndefined();
      expect(plan.warnings.join("\n")).toMatch(/report metadata.*invalid.*decision blocked/i);

      const updated = await publisherService.updateBody({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        requestNumber: "472",
        allowBlockedBody: true,
        pushBranch: false,
        confirm: true,
      });
      expect(updated.result).toMatchObject({
        status: "blocked",
        errorCode: "PUBLISH_REPORT_METADATA_INVALID",
        requestSynced: false,
      });
      expect(updated.result.errorMessage).toMatch(/intent unknown.*decision blocked/i);
      expect(githubPublisher.updatedMetadata).toHaveLength(0);
    },
  );

  it("rejects crossed report metadata and reports both known values", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await generatePrReport({
      runId: run.id,
      metadata: {
        reportKind: "pr-body-markdown",
        reportIntent: "ready",
        decision: "blocked",
      },
    });

    const plan = await publisherService.plan({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      pushBranch: false,
    });
    expect(plan).toMatchObject({
      reportMetadataValid: false,
      reportIntent: "ready",
      reportDecision: "blocked",
      willCreateOrUpdate: false,
    });
    expect(plan.warnings.join("\n")).toMatch(/intent ready.*decision blocked/i);

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      pushBranch: false,
      confirm: true,
    });
    expect(published.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_REPORT_METADATA_INVALID",
      requestSynced: false,
    });
    expect(published.result.errorMessage).toMatch(/intent ready.*decision blocked/i);
    expect(githubPublisher.createdPayloads).toHaveLength(0);
    expect(githubPublisher.updatedMetadata).toHaveLength(0);
  });

  it("can sync a blocked report into an existing review request body when explicitly allowed", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    expect(report.decision).toBe("blocked");
    githubPublisher.existingRequest = existingDraftRequest("474");

    const updated = await publisherService.updateBody({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      requestNumber: "474",
      allowBlockedBody: true,
      confirm: true,
    });

    expect(updated.result).toMatchObject({
      status: "blocked",
      requestSynced: true,
      request: {
        number: "474",
        updated: true,
      },
    });
    expect(updated.agentResultId).toBeUndefined();
    expect(githubPublisher.updatedBodies[0]).toContain("# 요약");
    expect(githubPublisher.updatedBodies[0]).toContain("## 결정");
  });

  it("can sync a blocked report using the blocked draft update publish mode", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    const report = await prReportService.generatePrReport({
      runId: run.id,
    });
    githubPublisher.existingRequest = existingDraftRequest("475");

    const updated = await publisherService.updateBody({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      requestNumber: "475",
      publishMode: "blocked-draft-update",
      confirm: true,
    });

    expect(updated.result).toMatchObject({
      status: "blocked",
      requestSynced: true,
      request: {
        number: "475",
        updated: true,
      },
    });
    expect(githubPublisher.updatedBodies[0]).toContain("blocked");
  });

  it("honors intake constraints that keep visual diff images out of the PR body", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    await addParsedIntakePolicy(run.id, {
      includeDiff: false,
    });

    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    expect(report.decision).toBe("ready");

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(githubPublisher.uploadedAssets[0]?.map((asset) => asset.role)).toEqual([
      "figma",
      "browser",
    ]);
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/figma.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/browser.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain(
      "https://github.example/assets/diff.png",
    );
  });

  it("injects legacy-screenshot visual previews with legacy and target labels", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id, {
      visualBaseline: "legacy-screenshot",
    });

    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "| 화면 | 레거시 | 이관 결과 | 일치율 |",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "레거시 화면과 이관 결과를 같은 조건으로 비교했습니다.",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain(
      "| 대상 | Figma | Browser | Diff",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain("98.00%");
  });

  it("records failed publish and no publisher AgentResult when API body sync fails", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);

    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    githubPublisher.failCreate = true;

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result).toMatchObject({
      status: "failed",
      requestSynced: false,
      visualPreviewExpected: false,
      visualPreviewSynced: false,
    });
    expect(published.result.partialReasons.join("\n")).toContain("body sync failed");
    expect(published.agentResultId).toBeUndefined();

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
  });

  it("records failed publish when required visual evidence upload cannot be synchronized", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);

    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    githubPublisher.failAssetUpload = true;

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result).toMatchObject({
      status: "failed",
      requestSynced: false,
      visualPreviewExpected: true,
      visualPreviewSynced: false,
    });
    expect(published.result.partialReasons.join("\n")).toContain("visual evidence upload failed");
    expect(githubPublisher.createdPayloads).toHaveLength(0);

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
  });

  it("publishes one feature E2E video as a link without treating it as a visual preview", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addFeatureVideoEvidence(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });

    gitCurrentBranch = "spec-to-pr/run-feature";
    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-feature",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result).toMatchObject({
      status: "passed",
      visualPreviewExpected: false,
      featureVideoExpected: true,
      featureVideoSynced: true,
    });
    expect(githubPublisher.uploadedAssets[0]).toEqual([{ role: "e2e-video" }]);
    expect(githubPublisher.createdPayloads[0]?.body).toContain("Feature E2E Evidence");
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/e2e-video.webm",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("<video");
    const stored = await store.get(run.id);
    const publishArtifact = stored.artifacts.find(
      (artifact) => artifact.metadata["reportKind"] === "publish-result",
    );
    expect(publishArtifact?.metadata).toMatchObject({
      featureVideoExpected: true,
      featureVideoSynced: true,
    });
  });
});

async function addFeatureVideoEvidence(runId: string): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:00.950Z";
  const video = await writeArtifact({
    id: "art_77777777777777777777777777777777",
    kind: "other",
    label: "checkout.webm",
    reportKind: "feature-e2e-video",
    content: Buffer.from("bounded feature video"),
    mediaType: "video/webm",
    timestamp,
    metadata: {
      workflowSubmissionKind: "implementation",
      featureEvidenceRole: "video",
      projectRelativePath: "test-results/checkout.webm",
    },
  });

  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, video],
    },
    run.revision,
  );
}

async function markRunReadyForPublish(runId: string): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:00.500Z";
  const reportArtifactId = "art_11111111111111111111111111111111";
  const checks = [
    {
      id: "chk_11111111111111111111111111111111",
      name: "lint",
      kind: "lint" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "lint passed.",
    },
    {
      id: "chk_22222222222222222222222222222222",
      name: "typecheck",
      kind: "typecheck" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "typecheck passed.",
    },
    {
      id: "chk_33333333333333333333333333333333",
      name: "build",
      kind: "build" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "build passed.",
    },
    {
      id: "chk_44444444444444444444444444444444",
      name: "unit",
      kind: "unit" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "unit passed.",
    },
    {
      id: "chk_55555555555555555555555555555555",
      name: "component",
      kind: "component" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "component passed.",
    },
    {
      id: "chk_66666666666666666666666666666666",
      name: "contract",
      kind: "contract" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "contract passed.",
    },
    {
      id: "chk_77777777777777777777777777777777",
      name: "openspec",
      kind: "openspec" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "openspec passed.",
    },
    {
      id: "chk_88888888888888888888888888888888",
      name: "accessibility",
      kind: "accessibility" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "accessibility passed.",
    },
    {
      id: "chk_99999999999999999999999999999999",
      name: "performance",
      kind: "performance" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "performance passed.",
    },
    {
      id: "chk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "security",
      kind: "security" as const,
      status: "passed" as const,
      exitCode: 0,
      summary: "security passed.",
    },
  ];
  const observabilityArtifact = await writeArtifact({
    id: "art_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "telemetry-config",
    label: "observability-report.json",
    reportKind: "observability-report-json",
    content: Buffer.from("{}\n"),
    mediaType: "application/json",
    timestamp,
  });
  const scorecardArtifact = await writeArtifact({
    id: "art_99999999999999999999999999999999",
    kind: "review-scorecard",
    label: "review-scorecard.json",
    reportKind: "review-scorecard-json",
    content: Buffer.from("{}\n"),
    mediaType: "application/json",
    timestamp,
    metadata: {
      minimumScore: 8,
      lowestScore: 8,
      decision: "passed",
      dimensions: [
        {
          id: "tdd-evidence",
          label: "TDD evidence",
          score: 8,
          threshold: 8,
          status: "warning",
          notes: "Executable test evidence meets the minimum score.",
        },
      ],
    },
  });

  await store.save(
    {
      ...run,
      status: "completed",
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [
        ...run.artifacts,
        {
          id: reportArtifactId,
          kind: "test-report",
          uri: "artifact://sha256/111",
          mediaType: "application/json",
          digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          producedBy: "functional-reviewer",
          evidenceIds: [],
          createdAt: timestamp,
          metadata: {
            reportKind: "verification-report",
          },
        },
        observabilityArtifact,
        scorecardArtifact,
      ],
      agentResults: [
        ...run.agentResults,
        {
          schemaVersion: "2.0.0",
          id: "ar_11111111111111111111111111111111",
          runId: run.id,
          kind: "verification",
          agent: "functional-reviewer",
          status: "passed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: [reportArtifactId],
          gapIds: [],
          checks,
          decisions: [],
          startedAt: timestamp,
          completedAt: timestamp,
        },
      ],
    },
    run.revision,
  );
}

async function generatePrReport(input: {
  runId: string;
  metadata?: Record<string, unknown>;
  body?: string;
}) {
  const run = await store.get(input.runId);
  const timestamp = "2026-06-23T00:00:01.000Z";
  const decision = run.agentResults.some(
    (result) => result.kind === "verification" && result.status === "passed",
  )
    ? "ready"
    : "blocked";
  const generatedMarkdown = [
    "# 요약",
    "",
    decision === "ready" ? "검증된 변경입니다." : "검증이 완료되지 않았습니다.",
    "",
    "## 결정",
    "",
    decision,
    "",
  ].join("\n");
  const markdown = input.body ?? generatedMarkdown;
  const blob = await artifactStore.writeBlob({
    content: Buffer.from(markdown),
    mediaType: "text/markdown",
    storedAt: timestamp,
    label: "pr-report.md",
  });
  const artifact = ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: "pr-report",
    uri: blob.uri,
    mediaType: "text/markdown",
    digest: blob.digest,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: timestamp,
    metadata: input.metadata ?? {
      reportKind: "pr-body-markdown",
      reportIntent: decision === "ready" ? "ready" : "blocked-diagnostic",
      decision,
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
  return { decision, markdownArtifactId: artifact.id };
}

async function getPrReport(input: { runId: string; artifactId: string }) {
  const run = await store.get(input.runId);
  const artifact = run.artifacts.find((item) => item.id === input.artifactId);
  if (artifact === undefined) throw new Error("Missing report artifact");
  return {
    markdown: (await artifactStore.readContent(artifact.digest)).toString("utf8"),
  };
}

async function addVisualEvidence(
  runId: string,
  options: { visualBaseline?: "figma" | "legacy-screenshot" } = {},
): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:00.750Z";
  const artifacts = [
    await writeArtifact({
      id: "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      kind: "figma-mcp-capability-report",
      label: "figma-provider.json",
      reportKind: "figma-mcp-capability-report",
      content: Buffer.from("{}\n"),
      mediaType: "application/json",
      timestamp,
    }),
    await writeArtifact({
      id: "art_cccccccccccccccccccccccccccccccc",
      kind: "figma-design-inventory",
      label: "figma-inventory.json",
      reportKind: "figma-design-inventory",
      content: Buffer.from("{}\n"),
      mediaType: "application/json",
      timestamp,
    }),
    await writeArtifact({
      id: "art_dddddddddddddddddddddddddddddddd",
      kind: "figma-design-contract",
      label: "figma-design-contract.json",
      reportKind: "figma-design-contract",
      content: Buffer.from("{}\n"),
      mediaType: "application/json",
      timestamp,
    }),
    await writeArtifact({
      id: "art_22222222222222222222222222222222",
      kind: "figma-screenshot",
      label: "figma-home.png",
      reportKind: "figma-screenshot",
      content: Buffer.from("figma-png"),
      mediaType: "image/png",
      timestamp,
    }),
    await writeArtifact({
      id: "art_33333333333333333333333333333333",
      kind: "screenshot",
      label: "browser-home.png",
      reportKind: "browser-screenshot",
      content: Buffer.from("browser-png"),
      mediaType: "image/png",
      timestamp,
    }),
    await writeArtifact({
      id: "art_44444444444444444444444444444444",
      kind: "visual-diff",
      label: "diff-home.png",
      reportKind: "visual-diff",
      content: Buffer.from("diff-png"),
      mediaType: "image/png",
      timestamp,
    }),
  ];
  const visualReport = {
    runId,
    changeName: "home",
    ...(options.visualBaseline === undefined ? {} : { visualBaseline: options.visualBaseline }),
    generatedAt: timestamp,
    targetCount: 1,
    passedCount: 1,
    failedCount: 0,
    reviewNeededCount: 0,
    results: [
      {
        targetId: "home-desktop",
        status: "passed",
        figmaScreenshotArtifactId: "art_22222222222222222222222222222222",
        browserScreenshotArtifactId: "art_33333333333333333333333333333333",
        diffArtifactId: "art_44444444444444444444444444444444",
        metrics: {
          width: 100,
          height: 100,
          comparedPixelCount: 10_000,
          maskedPixelCount: 0,
          exactMatchRatio: 0.95,
          reviewMatchRatio: 0.98,
          meanDistance: 0.1,
          maxDistance: 1,
        },
        gapIds: [],
        notes: [],
      },
    ],
  };
  const visualReportArtifact = await writeArtifact({
    id: "art_55555555555555555555555555555555",
    kind: "visual-report",
    label: "visual-report.json",
    reportKind: "visual-report-json",
    content: Buffer.from(`${JSON.stringify(visualReport, null, 2)}\n`),
    mediaType: "application/json",
    timestamp,
    metadata: {
      changeName: "home",
      decision: "passed",
    },
  });

  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...artifacts, visualReportArtifact],
    },
    run.revision,
  );
}

async function addParsedIntakePolicy(
  runId: string,
  visualPreviewPolicy: { includeDiff?: boolean },
): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:00.900Z";
  const artifact = await writeArtifact({
    id: "art_66666666666666666666666666666666",
    kind: "parsed-intake-request",
    label: "parsed-intake-request.json",
    reportKind: "parsed-intake-request",
    content: Buffer.from(
      `${JSON.stringify(
        {
          runId,
          generatedAt: timestamp,
          parsed: {
            parserVersion: "intake-request-parser-v1",
            figmaUrls: [],
            urls: [],
            filePaths: [],
            ticketUrls: [],
            inlineOpenApiBlocks: [],
            branchPolicy: {},
            validationCommands: [],
            constraints: ["diff 이미지는 MR 본문에 넣지 말고 artifact로만 남겨."],
            publishPolicy: {},
            archivePolicy: {},
            targetHints: [],
            visualPreviewPolicy,
          },
        },
        null,
        2,
      )}\n`,
    ),
    mediaType: "application/json",
    timestamp,
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
}

async function writeArtifact(input: {
  id: string;
  kind:
    | "figma-mcp-capability-report"
    | "figma-design-inventory"
    | "figma-design-contract"
    | "figma-screenshot"
    | "screenshot"
    | "visual-diff"
    | "visual-report"
    | "review-scorecard"
    | "telemetry-config"
    | "parsed-intake-request"
    | "other";
  label: string;
  reportKind: string;
  content: Buffer;
  mediaType: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}) {
  const blob = await artifactStore.writeBlob({
    content: input.content,
    mediaType: input.mediaType,
    storedAt: input.timestamp,
    label: input.label,
  });

  return {
    id: input.id,
    kind: input.kind,
    uri: blob.uri,
    mediaType: input.mediaType,
    digest: blob.digest,
    producedBy: "orchestrator" as const,
    evidenceIds: [],
    createdAt: input.timestamp,
    metadata: {
      reportKind: input.reportKind,
      label: input.label,
      ...(input.metadata ?? {}),
    },
  };
}

class FakePublisher implements ReviewRequestPublisher {
  public readonly createdPayloads: ReviewRequestPayload[] = [];
  public readonly updatedBodies: string[] = [];
  public readonly updatedMetadata: ReviewRequestUpdate[] = [];
  public readonly uploadedAssets: Array<Array<{ role: string }>> = [];
  public readonly receivedSignals: Array<AbortSignal | undefined> = [];
  public failCreate = false;
  public failAssetUpload = false;
  public existingRequest: PublishedReviewRequest | undefined;
  public forceNonDraftResult = false;

  public constructor(private readonly host: "github" | "gitlab") {}

  public async findExisting(input: {
    signal?: AbortSignal;
  }): Promise<PublishedReviewRequest | undefined> {
    this.receivedSignals.push(input.signal);
    return this.existingRequest;
  }

  public async publishAssets(input: {
    assets: Array<{ role: string; artifactId: string; label: string; targetId: string }>;
  }) {
    if (this.failAssetUpload) {
      throw new Error("forced visual evidence upload failure");
    }

    this.uploadedAssets.push(input.assets.map((asset) => ({ role: asset.role })));

    return input.assets.map((asset) => ({
      artifactId: asset.artifactId,
      role: asset.role as "figma" | "browser" | "diff" | "overlay" | "e2e-video",
      targetId: asset.targetId,
      label: asset.label,
      url: `https://github.example/assets/${asset.role}${asset.role === "e2e-video" ? ".webm" : ".png"}`,
      embeddable: asset.role !== "e2e-video",
    }));
  }

  public async create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest> {
    if (this.failCreate) {
      throw new Error("forced create body sync failure");
    }

    this.createdPayloads.push(input.payload);

    return {
      host: this.host,
      url:
        this.host === "github"
          ? "https://github.com/acme/spec-to-pr/pull/123"
          : "https://gitlab.com/acme/spec-to-pr/-/merge_requests/123",
      number: "123",
      id: "123",
      draft: this.forceNonDraftResult ? false : input.payload.mode === "draft",
      sourceBranch: input.payload.sourceBranch,
      targetBranch: input.payload.targetBranch,
      created: true,
      updated: false,
    };
  }

  public async update(input: {
    target: PublishTarget;
    requestNumber: string;
    update: ReviewRequestUpdate;
    token: string;
  }): Promise<PublishedReviewRequest> {
    this.updatedMetadata.push(input.update);
    this.updatedBodies.push(input.update.body);

    return {
      host: this.host,
      url:
        this.host === "github"
          ? `https://github.com/acme/spec-to-pr/pull/${input.requestNumber}`
          : `https://gitlab.com/acme/spec-to-pr/-/merge_requests/${input.requestNumber}`,
      number: input.requestNumber,
      id: input.requestNumber,
      draft: true,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      created: false,
      updated: true,
    };
  }
}

function existingDraftRequest(number: string): PublishedReviewRequest {
  return {
    host: "github",
    url: `https://github.com/acme/spec-to-pr/pull/${number}`,
    number,
    id: number,
    draft: true,
    sourceBranch: "spec-to-pr/run-1",
    targetBranch: "main",
    created: false,
    updated: false,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
