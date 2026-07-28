import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { PublisherService } from "../../src/application/publisher-service.js";
import { RunService } from "../../src/application/run-service.js";
import { PrReportV2Schema } from "../../src/pr-report/pr-report-model.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import type {
  PublishedReviewRequest,
  PublishTarget,
  ReviewAssetPublishOutcome,
  ReviewRequestAsset,
  ReviewRequestPayload,
  ReviewRequestPublisher,
  ReviewRequestUpdate,
} from "../../src/publisher/index.js";
import { GitHubPublisherAdapter } from "../../src/publisher/index.js";
import { GitLabAssetUploadError } from "../../src/publisher/gitlab-publisher.js";
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
const canonicalReviewPacketId = `packet_${"c".repeat(64)}`;
const canonicalDiffDigest = `sha256:${"d".repeat(64)}`;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-publisher-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });
  projectRoot = await realpath(projectRoot);

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
        if (args.at(-1) === "--show-toplevel") {
          return { stdout: `${projectRoot}\n`, stderr: "" };
        }
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
  it("rejects caller overrides and workspace drift for a pinned publication", async () => {
    gitCurrentBranch = "codex/pinned";
    const run = await runService.createRun({
      projectRoot,
      workspaceBinding: {
        repositoryRoot: projectRoot,
        targetPaths: ["src/page/shop"],
        supportingPaths: [],
        sourceBranch: "codex/pinned",
        targetBranch: "release-qa",
        baseSha: gitHead,
        initialHeadSha: gitHead,
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/spec-to-pr.git",
        remoteProvider: "github",
        remoteHost: "github.com",
        publicationTarget: {
          host: "github",
          webBaseUrl: "https://github.com",
          apiBaseUrl: "https://api.github.com",
          owner: "acme",
          repo: "spec-to-pr",
        },
      },
    });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const baseInput = {
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "codex/pinned",
      targetBranch: "release-qa",
      remoteName: "origin",
      pushBranch: false,
    } as const;

    await expect(
      publisherService.plan({ ...baseInput, sourceBranch: "codex/other" }),
    ).rejects.toThrow(/WORKSPACE_BRANCH_MISMATCH/);
    await expect(
      publisherService.plan({
        ...baseInput,
        remoteUrl: "https://github.com/attacker/spec-to-pr.git",
      }),
    ).rejects.toThrow(/WORKSPACE_REMOTE_MISMATCH/);

    gitCurrentBranch = "codex/other";
    await expect(publisherService.plan(baseInput)).rejects.toThrow(/WORKSPACE_BRANCH_MISMATCH/);
    expect(githubPublisher.createdPayloads).toHaveLength(0);
  });

  it("resolves bound Git and remote state once for one authoritative publish call", async () => {
    gitCurrentBranch = "codex/pinned";
    const run = await runService.createRun({
      projectRoot,
      workspaceBinding: {
        repositoryRoot: projectRoot,
        targetPaths: ["src/page/shop"],
        supportingPaths: [],
        sourceBranch: "codex/pinned",
        targetBranch: "release-qa",
        baseSha: gitHead,
        initialHeadSha: gitHead,
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/spec-to-pr.git",
        remoteProvider: "github",
        remoteHost: "github.com",
        publicationTarget: {
          host: "github",
          webBaseUrl: "https://github.com",
          apiBaseUrl: "https://api.github.com",
          owner: "acme",
          repo: "spec-to-pr",
        },
      },
    });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    gitCalls = [];

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "codex/pinned",
      targetBranch: "release-qa",
      remoteName: "origin",
      pushBranch: false,
      confirm: true,
    });

    expect(gitCalls.filter((args) => args[0] === "status")).toHaveLength(1);
    expect(gitCalls.filter((args) => args[0] === "symbolic-ref")).toHaveLength(1);
    expect(
      gitCalls.filter((args) => args[0] === "rev-parse" && args.at(-1) === "HEAD"),
    ).toHaveLength(1);
    expect(
      gitCalls.filter((args) => args[0] === "rev-parse" && args.at(-1) === "codex/pinned"),
    ).toHaveLength(1);
    expect(gitCalls.filter((args) => args[0] === "remote")).toHaveLength(1);
    expect(gitCalls.filter((args) => args[0] === "rev-list")).toHaveLength(1);
  });

  it("invalidates the private publication fence when the Run revision changes", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    let reads = 0;
    const changingStore: RunStore = {
      create: (manifest) => store.create(manifest),
      get: async (runId) => {
        const current = await store.get(runId);
        reads += 1;
        return reads < 3 ? current : { ...current, revision: current.revision + 1 };
      },
      list: (filter) => store.list(filter),
      save: (manifest, expectedRevision) => store.save(manifest, expectedRevision),
      close: async () => {},
    };
    const fencedService = new PublisherService(
      changingStore,
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

    await expect(
      fencedService.publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        pushBranch: false,
        confirm: true,
      }),
    ).rejects.toThrow(/PUBLISH_EXECUTION_FENCE_STALE/);
    expect(githubPublisher.createdPayloads).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["malformed", { id: canonicalReviewPacketId, headSha: gitHead }],
    [
      "mismatched",
      {
        id: `packet_${"e".repeat(64)}`,
        headSha: gitHead,
      },
    ],
  ] as const)(
    "rejects a %s current implementation packet before push or provider mutation",
    async (_name, reviewPacket) => {
      const run = await runService.createRun({ projectRoot });
      await markRunReadyForPublish(run.id);
      const report = await prReportService.generatePrReport({ runId: run.id });
      await replaceImplementationReviewPacket(run.id, reviewPacket);
      const gitCallsBeforePublish = gitCalls.length;

      await expect(
        publisherService.publish({
          runId: run.id,
          reportArtifactId: report.markdownArtifactId,
          sourceBranch: "spec-to-pr/run-1",
          targetBranch: "main",
          pushBranch: true,
          confirm: true,
        }),
      ).rejects.toThrow(/PUBLISH_EXECUTION_FENCE_STALE.*review packet/i);

      expect(gitCalls.slice(gitCallsBeforePublish).some((args) => args[0] === "push")).toBe(false);
      expect(githubPublisher.createdPayloads).toHaveLength(0);
      expect(githubPublisher.updatedMetadata).toHaveLength(0);
      expect(githubPublisher.uploadedAssets).toHaveLength(0);
    },
  );

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
    expect(githubPublisher.createdPayloads[0]?.body).toContain("### Figma와 브라우저 결과");
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/figma.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/browser.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
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

    expect(githubPublisher.createdPayloads[0]?.body).toContain("### Figma와 브라우저 결과");
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
      `${gitHead}:refs/heads/spec-to-pr/run-upstream`,
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

  it("rejects a blocked canonical report requested with ready intent", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    expect(report.decision).toBe("blocked");

    await expect(
      publisherService.publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        pushBranch: false,
        confirm: true,
      }),
    ).rejects.toThrow(/PUBLISH_REPORT_BINDING_INVALID.*intent/i);

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
  });

  it("creates a synchronized blocked diagnostic draft without requiring a reviewed head SHA", async () => {
    const run = await runService.createRun({ projectRoot });
    await addFeatureVideoEvidence(run.id);
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
    expect(plan.payload).not.toHaveProperty("reviewPacketId");
    expect(plan.payload).not.toHaveProperty("headSha");

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
      featureVideoExpected: false,
      featureVideoSynced: false,
      request: { number: "123", draft: true, created: true },
    });
    expect(published.result.errorCode).toBeUndefined();
    expect(published.agentResultId).toBeUndefined();
    expect(githubPublisher.createdPayloads[0]).toMatchObject({
      title: `[Blocked] SpecToPR Run ${run.id}`,
      labels: ["spec-to-pr", "spec-to-pr:blocked"],
    });
    expect(githubPublisher.uploadedAssets).toHaveLength(0);
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

  it("binds a blocked visual publication to the exact canonical packet and report", async () => {
    const run = await runService.createRun({ projectRoot });
    await addVisualEvidence(run.id);
    const report = await generatePrReport({
      runId: run.id,
      binding: {
        reviewPacketId: canonicalReviewPacketId,
        headSha: gitHead,
        diffDigest: canonicalDiffDigest,
      },
      visualReportArtifactId: "art_55555555555555555555555555555555",
    });

    const plan = await publisherService.plan({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      pushBranch: false,
    });

    expect(plan.payload).toMatchObject({
      reviewPacketId: canonicalReviewPacketId,
      headSha: gitHead,
    });

    const mismatchedHeadService = new PublisherService(
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
                ? `${"b".repeat(40)}\n`
                : args[0] === "rev-list"
                  ? "1\n"
                  : "https://github.com/acme/spec-to-pr.git\n",
        stderr: "",
      }),
    );
    await expect(
      mismatchedHeadService.publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        intent: "blocked-diagnostic",
        pushBranch: false,
        confirm: true,
      }),
    ).rejects.toThrow(/reviewed source SHA/);
  });

  it("renders the bound failed report as an equal-size two-column blocked visual preview", async () => {
    const run = await runService.createRun({ projectRoot });
    await addVisualEvidence(run.id, {
      status: "failed",
      includeOverlay: true,
      context: {
        targetId: "store-cinema4k",
        name: "매장 상세",
        route: "/shop/stores/123",
        state: "available",
        viewport: { width: 360, height: 1831 },
        deviceScaleFactor: 1,
      },
      metrics: {
        exactMatchRatio: 0.84,
        reviewMatchRatio: 0.912,
        maskedAreaRatio: 0,
        threshold: 0.92,
      },
    });
    await addNewerUnboundVisualReport(run.id);
    await addParsedIntakePolicy(run.id, { includeDiff: false });
    const report = await generatePrReport({
      runId: run.id,
      binding: {
        reviewPacketId: canonicalReviewPacketId,
        headSha: gitHead,
        diffDigest: canonicalDiffDigest,
      },
      visualReportArtifactId: "art_55555555555555555555555555555555",
    });

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      intent: "blocked-diagnostic",
      pushBranch: false,
      confirm: true,
    });

    expect(githubPublisher.uploadedAssetIds[0]).toEqual([
      "art_22222222222222222222222222222222",
      "art_33333333333333333333333333333333",
      "art_44444444444444444444444444444444",
      "art_88888888888888888888888888888888",
    ]);
    const body = githubPublisher.createdPayloads[0]?.body ?? "";
    expect(body).toContain('width="320"');
    expect(body.match(/width="320"/g)).toHaveLength(2);
    expect(body).toContain("검토 일치율");
    expect(body).toContain("불일치율");
    expect(body).toContain("Diff");
    expect(body).toContain("Overlay");
    expect(body).toContain("91.20%");
    expect(body).toContain("8.80%");
    expect(body).toContain("92.00%");
    expect(body).not.toContain("unbound-newer-report.png");
  });

  it.each([
    ["diff", { includeDiff: false }],
    ["overlay", { includeOverlay: false }],
  ] as const)(
    "fails closed before host mutation when blocked visual publication lacks its required %s",
    async (role, fixture) => {
      const run = await runService.createRun({ projectRoot });
      await addVisualEvidence(run.id, { status: "failed", ...fixture });
      const report = await generatePrReport({
        runId: run.id,
        binding: {
          reviewPacketId: canonicalReviewPacketId,
          headSha: gitHead,
          diffDigest: canonicalDiffDigest,
        },
        visualReportArtifactId: "art_55555555555555555555555555555555",
      });

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
        status: "failed",
        errorCode: "PUBLISH_FAILED",
        requestSynced: false,
        visualPreviewExpected: false,
        visualPreviewSynced: false,
      });
      expect(published.result.errorMessage).toMatch(
        new RegExp(`missing an? ${role} artifact`, "i"),
      );
      expect(githubPublisher.uploadedAssetIds).toHaveLength(0);
      expect(githubPublisher.createdPayloads).toHaveLength(0);
      expect(githubPublisher.updatedMetadata).toHaveLength(0);
    },
  );

  it("starts a separate compact preview block for each visual target", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    await appendSecondVisualTarget(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    const body = githubPublisher.createdPayloads[0]?.body ?? "";
    expect(body).toContain("#### 화면 1 · 고정된 검토 데이터");
    expect(body).toContain("#### 화면 2 · 두 번째 검토 데이터");
    expect(body.match(/\| 경로 \| 상태 \| Fixture \| 화면/g)).toHaveLength(2);
    expect(body.match(/\| Figma \| 브라우저 \|/g)).toHaveLength(2);
  });

  it("rejects a crossed blocked report and visual artifact binding", async () => {
    const run = await runService.createRun({ projectRoot });
    await addVisualEvidence(run.id);
    const report = await generatePrReport({
      runId: run.id,
      binding: {
        reviewPacketId: `packet_${"e".repeat(64)}`,
        headSha: gitHead,
        diffDigest: canonicalDiffDigest,
      },
      visualReportArtifactId: "art_55555555555555555555555555555555",
    });

    await expect(
      publisherService.plan({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        intent: "blocked-diagnostic",
        pushBranch: false,
      }),
    ).rejects.toThrow(/PUBLISH_REPORT_BINDING_INVALID/);
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

  it("persists digest-bound upload receipts and retries only the missing asset on the same draft", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const input = {
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true as const,
    };
    const transientId = "art_33333333333333333333333333333333";
    githubPublisher.assetOutcomePlan = ({ invocation, assets }) =>
      assets.map((asset) =>
        asset.artifactId === transientId && invocation <= 3
          ? {
              status: "failed" as const,
              artifactId: asset.artifactId,
              failure: "transient" as const,
              message: "GitHub upload review asset failed with HTTP 503",
            }
          : githubPublisher.publishedOutcome(asset),
      );

    const partial = await publisherService.publish(input);
    expect(partial.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      requestSynced: false,
      visualPreviewSynced: false,
      retryable: true,
      request: { created: true, updated: false },
    });
    expect(partial.result.uploadReceiptArtifactIds).toHaveLength(2);
    expect(githubPublisher.uploadedAssetIds).toEqual([
      [
        "art_22222222222222222222222222222222",
        "art_33333333333333333333333333333333",
        "art_44444444444444444444444444444444",
      ],
      [transientId],
      [transientId],
    ]);
    githubPublisher.existingRequest = {
      ...partial.result.request!,
      created: false,
      updated: false,
    };

    const recovered = await publisherService.publish(input);

    expect(githubPublisher.uploadedAssetIds.at(-1)).toEqual([transientId]);
    expect(githubPublisher.createdPayloads).toHaveLength(1);
    expect(githubPublisher.updatedMetadata).toHaveLength(1);
    expect(recovered.result).toMatchObject({
      status: "passed",
      requestSynced: true,
      visualPreviewSynced: true,
    });
    expect(recovered.result.uploadReceiptArtifactIds).toHaveLength(3);
    expect(
      (await store.get(run.id)).artifacts.filter(
        (artifact) => artifact.metadata["reportKind"] === "review-asset-upload-receipt",
      ),
    ).toHaveLength(3);
  });

  it("uploads a changed digest again instead of reusing the old receipt URL", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const input = {
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true as const,
    };
    const changedArtifactId = "art_33333333333333333333333333333333";
    const first = await publisherService.publish(input);
    githubPublisher.existingRequest = {
      ...first.result.request!,
      created: false,
      updated: false,
    };
    const current = await store.get(run.id);
    const changedBlob = await artifactStore.writeBlob({
      content: Buffer.from("changed-browser-png"),
      mediaType: "image/png",
      storedAt: "2026-06-23T00:00:03.000Z",
      label: "browser-home.png",
    });
    await store.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: "2026-06-23T00:00:03.000Z",
        artifacts: current.artifacts.map((artifact) =>
          artifact.id === changedArtifactId
            ? ArtifactRefSchema.parse({
                ...artifact,
                uri: changedBlob.uri,
                digest: changedBlob.digest,
              })
            : artifact,
        ),
      },
      current.revision,
    );
    githubPublisher.assetOutcomePlan = ({ assets }) =>
      assets.map((asset) => {
        const outcome = githubPublisher.publishedOutcome(asset);
        if (outcome.status !== "published" || asset.artifactId !== changedArtifactId) {
          return outcome;
        }
        return {
          ...outcome,
          asset: {
            ...outcome.asset,
            url: `https://github.example/assets/browser-${asset.artifactDigest.slice(-12)}.png`,
          },
        };
      });

    const second = await publisherService.publish(input);

    expect(githubPublisher.uploadedAssetIds).toEqual([
      [
        "art_22222222222222222222222222222222",
        changedArtifactId,
        "art_44444444444444444444444444444444",
      ],
      [changedArtifactId],
    ]);
    const firstUrl = first.result.publishedAssets.find(
      (asset) => asset.artifactId === changedArtifactId,
    )?.url;
    const secondUrl = second.result.publishedAssets.find(
      (asset) => asset.artifactId === changedArtifactId,
    )?.url;
    expect(secondUrl).toBeDefined();
    expect(secondUrl).not.toBe(firstUrl);
    expect(second.result.uploadReceiptArtifactIds).toHaveLength(3);
    expect(
      (await store.get(run.id)).artifacts.filter(
        (artifact) => artifact.metadata["reportKind"] === "review-asset-upload-receipt",
      ),
    ).toHaveLength(4);
  });

  it.each([
    ["permanent", "GitHub upload review asset failed with HTTP 400"],
    ["uncertain", "GitHub upload review asset returned a malformed response"],
  ] as const)("does not retry %s upload failures", async (failure, message) => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    const failedId = "art_33333333333333333333333333333333";
    githubPublisher.assetOutcomePlan = ({ assets }) =>
      assets.map((asset) =>
        asset.artifactId === failedId
          ? {
              status: "failed",
              artifactId: asset.artifactId,
              failure,
              message,
            }
          : githubPublisher.publishedOutcome(asset),
      );

    const partial = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(githubPublisher.uploadedAssetIds).toHaveLength(1);
    expect(partial.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      retryable: false,
      requestSynced: false,
    });
    expect(partial.result.uploadReceiptArtifactIds).toHaveLength(2);
  });

  it("keeps body sync blocked when the remote draft omits a confirmed asset URL", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.remoteBodyOverride = "# host truncated the visual evidence";

    const result = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(result.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      requestSynced: false,
      visualPreviewSynced: false,
      retryable: true,
    });
    expect(result.result.partialReasons.join("\n")).toContain("PUBLISH_ASSET_BODY_SYNC_INCOMPLETE");
  });

  it("keeps local body sync blocked before host mutation when a confirmed URL is absent", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.assetOutcomePlan = ({ assets }) =>
      assets.map((asset) => {
        const outcome = githubPublisher.publishedOutcome(asset);
        if (outcome.status !== "published") return outcome;
        return {
          ...outcome,
          asset: {
            ...outcome.asset,
            url: `${outcome.asset.url}?first=1&second=2`,
          },
        };
      });

    const result = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(result.result).toMatchObject({
      status: "blocked",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      requestSynced: false,
      visualPreviewSynced: false,
    });
    expect(result.result.partialReasons).toContain("PUBLISH_ASSET_BODY_SYNC_INCOMPLETE");
    expect(githubPublisher.createdPayloads).toHaveLength(0);
    expect(githubPublisher.updatedMetadata).toHaveLength(0);
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

  it("rejects a ready canonical report requested with blocked intent", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.existingRequest = existingDraftRequest("473");

    await expect(
      publisherService.updateBody({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        requestNumber: "473",
        allowBlockedBody: true,
        pushBranch: false,
        confirm: true,
      }),
    ).rejects.toThrow(/PUBLISH_REPORT_BINDING_INVALID.*intent/i);
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
  ])("rejects $name Markdown report metadata before canonical comparison", async ({ metadata }) => {
    const run = await runService.createRun({ projectRoot });
    const report = await generatePrReport({ runId: run.id, metadata });
    githubPublisher.existingRequest = existingDraftRequest("472");

    await expect(
      publisherService.plan({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        intent: "blocked-diagnostic",
        pushBranch: false,
      }),
    ).rejects.toThrow(/PUBLISH_REPORT_BINDING_INVALID.*metadata/i);
    expect(githubPublisher.updatedMetadata).toHaveLength(0);
  });

  it("rejects crossed Markdown metadata before canonical comparison", async () => {
    const run = await runService.createRun({ projectRoot });
    const report = await generatePrReport({
      runId: run.id,
      metadata: {
        reportKind: "pr-body-markdown",
        reportIntent: "ready",
        decision: "blocked",
      },
    });

    await expect(
      publisherService.plan({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        intent: "blocked-diagnostic",
        pushBranch: false,
      }),
    ).rejects.toThrow(/PUBLISH_REPORT_BINDING_INVALID.*metadata/i);
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
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain(
      "픽셀 차이 이미지도 함께 제공합니다.",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("overlay");
  });

  it("injects legacy-screenshot visual previews with all available comparison evidence", async () => {
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
      "| 경로 | 상태 | Fixture | 화면 | DPR | 시도 | 검토 일치율 | 불일치율 | 픽셀 일치율 | 마스킹 | 기준 | 결과 |",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "레거시 화면과 이관 결과를 같은 조건으로 비교했습니다.",
    );
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain(
      "| 대상 | Figma | Browser | Diff",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/diff.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain("진단: [Diff]");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("95.00%");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("98.00%");
    expect(githubPublisher.createdPayloads[0]?.body).not.toContain("overlay");
  });

  it("uses route, state, and viewport context instead of exposing opaque target IDs", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id, {
      visualBaseline: "legacy-screenshot",
      context: {
        targetId: "legacy_01e68a8c011c37b4b997f938",
        name: "매장 상세",
        route: "/shop/42?tab=notice&token=do-not-publish",
        state: "공지 탭 <펼침>",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      },
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

    const body = githubPublisher.createdPayloads[0]?.body ?? "";
    expect(body).toContain("매장 상세");
    expect(body).toContain("/shop/42?tab=notice&amp;token=[REDACTED]");
    expect(body).toContain("공지 탭 &lt;펼침&gt;");
    expect(body).toContain("390×844 | 2");
    expect(body).not.toContain("do-not-publish");
    expect(body).not.toContain("<펼침>");
    expect(body).not.toContain("legacy_01e68a8c011c37b4b997f938");
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

  it("records blocked partial publish when required visual evidence upload cannot be synchronized", async () => {
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
      status: "blocked",
      errorCode: "PUBLISH_PARTIAL_SYNC",
      requestSynced: false,
      visualPreviewExpected: true,
      visualPreviewSynced: false,
    });
    expect(published.result.partialReasons.join("\n")).toContain(
      "visual evidence upload incomplete",
    );
    expect(githubPublisher.createdPayloads).toHaveLength(1);

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
  });

  it("keeps a ready GitLab publication partial when required generated diff upload fails", async () => {
    const originalGitLabToken = process.env["GITLAB_TOKEN"];
    process.env["GITLAB_TOKEN"] = "glpat_test_token";

    try {
      const run = await runService.createRun({ projectRoot });
      await markRunReadyForPublish(run.id);
      await addVisualEvidence(run.id, { visualBaseline: "legacy-screenshot" });
      await bindVisualEvidenceToCommittedFiles(run.id);
      const report = await prReportService.generatePrReport({ runId: run.id });
      const rawFallbackService = createGitLabRawFallbackService();
      gitlabPublisher.assetUploadError = new GitLabAssetUploadError(
        "GitLab upload review asset failed: 503 uploads unavailable",
        503,
      );

      const published = await rawFallbackService.publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        remoteUrl: "https://gitlab.com/acme/spec-to-pr.git",
        headSha: gitHead,
        pushBranch: false,
        confirm: true,
      });

      expect(published.result).toMatchObject({
        status: "blocked",
        errorCode: "PUBLISH_PARTIAL_SYNC",
        requestSynced: false,
        visualPreviewExpected: true,
        visualPreviewSynced: false,
        fallbackMode: "none",
      });
      expect(published.result.partialReasons.join("\n")).toContain(
        "visual evidence upload incomplete",
      );
      expect(gitlabPublisher.createdPayloads).toHaveLength(1);
      expect(gitlabPublisher.createdPayloads[0]?.body).not.toContain("/-/raw/");
      const loadedRun = await store.get(run.id);
      expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
    } finally {
      if (originalGitLabToken === undefined) delete process.env["GITLAB_TOKEN"];
      else process.env["GITLAB_TOKEN"] = originalGitLabToken;
    }
  });

  it("refuses the GitLab raw-evidence fallback when HEAD blob bytes do not match the captured digest", async () => {
    const originalGitLabToken = process.env["GITLAB_TOKEN"];
    process.env["GITLAB_TOKEN"] = "glpat_test_token";

    try {
      const run = await runService.createRun({ projectRoot });
      await markRunReadyForPublish(run.id);
      await addVisualEvidence(run.id, { visualBaseline: "legacy-screenshot" });
      await addParsedIntakePolicy(run.id, { includeDiff: false });
      await bindVisualEvidenceToCommittedFiles(run.id);
      const report = await prReportService.generatePrReport({ runId: run.id });
      gitlabPublisher.assetUploadError = new GitLabAssetUploadError(
        "GitLab upload review asset failed: 503 uploads unavailable",
        503,
      );

      const published = await createGitLabRawFallbackService({
        headBlobContents: {
          ".spec-to-pr/shop/visual/current.png": "different-committed-browser-png",
        },
      }).publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        remoteUrl: "https://gitlab.com/acme/spec-to-pr.git",
        headSha: gitHead,
        pushBranch: false,
        confirm: true,
      });

      expect(published.result).toMatchObject({
        status: "blocked",
        errorCode: "PUBLISH_PARTIAL_SYNC",
        requestSynced: false,
        visualPreviewExpected: true,
        visualPreviewSynced: false,
        fallbackMode: "none",
      });
      expect(gitCalls).toContainEqual([
        "cat-file",
        "blob",
        `${gitHead}:.spec-to-pr/shop/visual/current.png`,
      ]);
      expect(gitlabPublisher.createdPayloads).toHaveLength(1);
    } finally {
      if (originalGitLabToken === undefined) delete process.env["GITLAB_TOKEN"];
      else process.env["GITLAB_TOKEN"] = originalGitLabToken;
    }
  });

  it("refuses GitLab raw fallback for a failed blocked diagnostic that requires all four visual roles", async () => {
    const originalGitLabToken = process.env["GITLAB_TOKEN"];
    process.env["GITLAB_TOKEN"] = "glpat_test_token";

    try {
      const run = await runService.createRun({ projectRoot });
      await addVisualEvidence(run.id, {
        visualBaseline: "legacy-screenshot",
        status: "failed",
        includeOverlay: true,
      });
      await bindVisualEvidenceToCommittedFiles(run.id);
      const report = await generatePrReport({
        runId: run.id,
        binding: {
          reviewPacketId: canonicalReviewPacketId,
          headSha: gitHead,
          diffDigest: canonicalDiffDigest,
        },
        visualReportArtifactId: "art_55555555555555555555555555555555",
      });
      gitlabPublisher.assetUploadError = new GitLabAssetUploadError(
        "GitLab upload review asset failed: 503 uploads unavailable",
        503,
      );

      const published = await createGitLabRawFallbackService().publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        remoteUrl: "https://gitlab.com/acme/spec-to-pr.git",
        intent: "blocked-diagnostic",
        pushBranch: false,
        confirm: true,
      });

      expect(published.result).toMatchObject({
        status: "blocked",
        errorCode: "PUBLISH_PARTIAL_SYNC",
        requestSynced: false,
        visualPreviewExpected: true,
        visualPreviewSynced: false,
        fallbackMode: "none",
      });
      expect(gitlabPublisher.createdPayloads).toHaveLength(1);
      expect(gitlabPublisher.createdPayloads[0]?.body).not.toContain("/-/raw/");
    } finally {
      if (originalGitLabToken === undefined) delete process.env["GITLAB_TOKEN"];
      else process.env["GITLAB_TOKEN"] = originalGitLabToken;
    }
  });

  it("names non-embeddable visual links with their screen context", async () => {
    const run = await runService.createRun({ projectRoot });
    await markRunReadyForPublish(run.id);
    await addVisualEvidence(run.id, { visualBaseline: "legacy-screenshot" });
    const report = await prReportService.generatePrReport({ runId: run.id });
    githubPublisher.visualAssetsEmbeddable = false;

    await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    const body = githubPublisher.createdPayloads[0]?.body ?? "";
    expect(body).toContain("[레거시 · 화면 1 ↗]");
    expect(body).toContain("[이관 결과 · 화면 1 ↗]");
    expect(body).toContain("[Diff · 화면 1 ↗]");
  });

  it("refuses the GitLab raw-evidence fallback when a committed screenshot no longer matches its captured digest", async () => {
    const originalGitLabToken = process.env["GITLAB_TOKEN"];
    process.env["GITLAB_TOKEN"] = "glpat_test_token";

    try {
      const run = await runService.createRun({ projectRoot });
      await markRunReadyForPublish(run.id);
      await addVisualEvidence(run.id, { visualBaseline: "legacy-screenshot" });
      await addParsedIntakePolicy(run.id, { includeDiff: false });
      await bindVisualEvidenceToCommittedFiles(run.id);
      await writeFile(
        path.join(projectRoot, ".spec-to-pr", "shop", "visual", "current.png"),
        Buffer.from("tampered-current-png"),
      );
      const report = await prReportService.generatePrReport({ runId: run.id });
      gitlabPublisher.assetUploadError = new GitLabAssetUploadError(
        "GitLab upload review asset failed: 503 uploads unavailable",
        503,
      );

      const published = await createGitLabRawFallbackService().publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        remoteUrl: "https://gitlab.com/acme/spec-to-pr.git",
        headSha: gitHead,
        pushBranch: false,
        confirm: true,
      });

      expect(published.result).toMatchObject({
        status: "blocked",
        errorCode: "PUBLISH_PARTIAL_SYNC",
        requestSynced: false,
        visualPreviewExpected: true,
        visualPreviewSynced: false,
        fallbackMode: "none",
      });
      expect(gitlabPublisher.createdPayloads).toHaveLength(1);
    } finally {
      if (originalGitLabToken === undefined) delete process.env["GITLAB_TOKEN"];
      else process.env["GITLAB_TOKEN"] = originalGitLabToken;
    }
  });

  it("refuses the GitLab raw-evidence fallback for a tracked symlink", async () => {
    const originalGitLabToken = process.env["GITLAB_TOKEN"];
    process.env["GITLAB_TOKEN"] = "glpat_test_token";

    try {
      const run = await runService.createRun({ projectRoot });
      await markRunReadyForPublish(run.id);
      await addVisualEvidence(run.id, { visualBaseline: "legacy-screenshot" });
      await addParsedIntakePolicy(run.id, { includeDiff: false });
      await bindVisualEvidenceToCommittedFiles(run.id);
      const report = await prReportService.generatePrReport({ runId: run.id });
      gitlabPublisher.assetUploadError = new GitLabAssetUploadError(
        "GitLab upload review asset failed: 503 uploads unavailable",
        503,
      );

      const published = await createGitLabRawFallbackService({ treeMode: "120000" }).publish({
        runId: run.id,
        reportArtifactId: report.markdownArtifactId,
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        remoteUrl: "https://gitlab.com/acme/spec-to-pr.git",
        headSha: gitHead,
        pushBranch: false,
        confirm: true,
      });

      expect(published.result).toMatchObject({
        status: "blocked",
        errorCode: "PUBLISH_PARTIAL_SYNC",
        requestSynced: false,
        fallbackMode: "none",
      });
      expect(gitlabPublisher.createdPayloads).toHaveLength(1);
    } finally {
      if (originalGitLabToken === undefined) delete process.env["GITLAB_TOKEN"];
      else process.env["GITLAB_TOKEN"] = originalGitLabToken;
    }
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
    expect(githubPublisher.createdPayloads[0]?.body).toContain("기능 E2E 영상");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("변경한 기능 녹화 보기");
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
      reviewPacketId: canonicalReviewPacketId,
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
      stages: run.stages.map((stage) =>
        stage.name === "implementation"
          ? {
              ...stage,
              checkpoint: {
                name: "implementation-complete",
                data: {
                  reviewPacket: canonicalImplementationReviewPacket(run.id),
                },
                updatedAt: timestamp,
              },
            }
          : stage,
      ),
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

function canonicalImplementationReviewPacket(runId: string) {
  return {
    id: canonicalReviewPacketId,
    runId,
    revision: 1,
    baseSha: "b".repeat(40),
    headSha: gitHead,
    evidenceDigest: `sha256:${"e".repeat(64)}`,
    diffDigest: canonicalDiffDigest,
    changedFiles: [],
  };
}

async function replaceImplementationReviewPacket(
  runId: string,
  reviewPacket: unknown,
): Promise<void> {
  const run = await store.get(runId);
  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: "2026-06-23T00:00:01.500Z",
      stages: run.stages.map((stage) =>
        stage.name === "implementation"
          ? {
              ...stage,
              checkpoint: {
                name: "implementation-complete",
                data: reviewPacket === undefined ? {} : { reviewPacket },
                updatedAt: "2026-06-23T00:00:01.500Z",
              },
            }
          : stage,
      ),
    },
    run.revision,
  );
}

async function generatePrReport(input: {
  runId: string;
  metadata?: Record<string, unknown>;
  body?: string;
  binding?: {
    reviewPacketId: string;
    headSha: string;
    diffDigest: string;
  };
  visualReportArtifactId?: string;
}) {
  const run = await store.get(input.runId);
  const timestamp = "2026-06-23T00:00:01.000Z";
  const decision = run.agentResults.some(
    (result) => result.kind === "verification" && result.status === "passed",
  )
    ? "ready"
    : "blocked";
  const canonicalDecision =
    input.metadata?.["decision"] === "ready" || input.metadata?.["decision"] === "blocked"
      ? input.metadata["decision"]
      : decision;
  const reportIntent =
    input.metadata?.["reportIntent"] === "ready" ||
    input.metadata?.["reportIntent"] === "blocked-diagnostic"
      ? input.metadata["reportIntent"]
      : canonicalDecision === "ready"
        ? "ready"
        : "blocked-diagnostic";
  const binding =
    input.binding ??
    (canonicalDecision === "ready"
      ? {
          reviewPacketId: canonicalReviewPacketId,
          headSha: gitHead,
          diffDigest: canonicalDiffDigest,
        }
      : undefined);
  const visualReportArtifactId =
    input.visualReportArtifactId ??
    (canonicalDecision === "ready"
      ? [...run.artifacts].reverse().find((artifact) => artifact.kind === "visual-report")?.id
      : undefined);
  const canonicalReport = PrReportV2Schema.parse({
    schemaVersion: "pr-report-v2.1",
    runId: run.id,
    generatedAt: timestamp,
    decision: canonicalDecision,
    mode: "auto",
    sectionStatuses: {
      api: "not-applicable",
      legacy: "not-applicable",
      visual: visualReportArtifactId === undefined ? "not-applicable" : "complete",
      "functional-review": canonicalDecision === "ready" ? "complete" : "not-run",
      "design-review": canonicalDecision === "ready" ? "complete" : "not-run",
      performance: "not-applicable",
      "feature-evidence": "not-applicable",
    },
    ...(binding === undefined
      ? {}
      : {
          binding: {
            reviewPacketId: binding.reviewPacketId,
            revision: 1,
            baseSha: "b".repeat(40),
            headSha: binding.headSha,
            evidenceDigest: `sha256:${"e".repeat(64)}`,
            diffDigest: binding.diffDigest,
          },
        }),
    summary: {
      title: canonicalDecision === "ready" ? "Ready fixture" : "Blocked fixture",
      bullets: [],
      exclusions: [],
    },
    sources: [],
    skills: { hints: [], applied: [] },
    requirements:
      canonicalDecision === "ready"
        ? [
            {
              id: "REQ-PUBLISH",
              title: "Publish reviewed evidence",
              acceptanceCriteria: ["The exact report binding is published."],
              implementationFiles: [],
              reviewVerdicts: ["approved"],
            },
          ]
        : [],
    changedFiles: [],
    implementationNotes: [],
    api: { applicable: false, operations: [], gaps: [] },
    legacy: { applicable: false, coverage: [] },
    visual: {
      applicable: visualReportArtifactId !== undefined,
      ...(visualReportArtifactId === undefined ? {} : { reportArtifactId: visualReportArtifactId }),
      attempt: visualReportArtifactId === undefined ? 0 : 1,
      status:
        visualReportArtifactId === undefined
          ? "not-applicable"
          : canonicalDecision === "ready"
            ? "passed"
            : "failed",
      results: [],
    },
    reviews: [],
    performance: { applicable: false },
    gaps: [],
    blockers: canonicalDecision === "blocked" ? ["Fixture blocker"] : [],
    unrunValidations: canonicalDecision === "blocked" ? ["functional-review"] : [],
    risks: [],
    rollback: {
      trigger: "Fixture regression.",
      strategy: "Revert the fixture.",
      steps: ["Revert the fixture."],
      dataImpact: "None.",
      postChecks: ["Rerun the fixture."],
    },
    evidencePaths: [],
    artifactIds: visualReportArtifactId === undefined ? [] : [visualReportArtifactId],
  });
  const jsonBlob = await artifactStore.writeBlob({
    content: Buffer.from(`${JSON.stringify(canonicalReport, null, 2)}\n`),
    mediaType: "application/json",
    storedAt: timestamp,
    label: "pr-report-v2.1.json",
  });
  const jsonArtifact = ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: "pr-report",
    uri: jsonBlob.uri,
    mediaType: "application/json",
    digest: jsonBlob.digest,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: timestamp,
    metadata: {
      reportKind: "pr-report-v2-json",
      reportSchemaVersion: "pr-report-v2.1",
      decision: canonicalDecision,
      ...(binding === undefined
        ? {}
        : {
            reviewPacketId: binding.reviewPacketId,
            headSha: binding.headSha,
            diffDigest: binding.diffDigest,
          }),
      ...(visualReportArtifactId === undefined ? {} : { visualReportArtifactId }),
    },
  });
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
    metadata: {
      ...(input.metadata ?? {
        reportKind: "pr-body-markdown",
        reportIntent,
        decision: canonicalDecision,
      }),
      reportJsonArtifactId: jsonArtifact.id,
      ...(binding === undefined
        ? {}
        : {
            reviewPacketId: binding.reviewPacketId,
            headSha: binding.headSha,
            diffDigest: binding.diffDigest,
          }),
      ...(visualReportArtifactId === undefined ? {} : { visualReportArtifactId }),
    },
  });
  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, jsonArtifact, artifact],
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
  options: {
    visualBaseline?: "figma" | "legacy-screenshot";
    status?: "passed" | "failed";
    includeDiff?: boolean;
    includeOverlay?: boolean;
    metrics?: {
      exactMatchRatio: number;
      reviewMatchRatio: number;
      maskedAreaRatio: number;
      threshold: number;
    };
    context?: {
      targetId: string;
      name: string;
      route: string;
      state: string;
      viewport: { width: number; height: number };
      deviceScaleFactor: number;
    };
  } = {},
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
    ...(options.includeDiff === false
      ? []
      : [
          await writeArtifact({
            id: "art_44444444444444444444444444444444",
            kind: "visual-diff",
            label: "diff-home.png",
            reportKind: "visual-diff",
            content: Buffer.from("diff-png"),
            mediaType: "image/png",
            timestamp,
          }),
        ]),
    ...(options.includeOverlay
      ? [
          await writeArtifact({
            id: "art_88888888888888888888888888888888",
            kind: "visual-diff",
            label: "overlay-home.png",
            reportKind: "visual-overlay",
            content: Buffer.from("overlay-png"),
            mediaType: "image/png",
            timestamp,
          }),
        ]
      : []),
  ];
  const commonMetrics = {
    width: 100,
    height: 100,
    comparedPixelCount: 10_000,
    maskedPixelCount: 0,
    exactMatchRatio: 0.95,
    reviewMatchRatio: 0.98,
    meanDistance: 0.1,
    maxDistance: 1,
  };
  const visualReport = {
    version: 2,
    runId,
    reviewPacketId: canonicalReviewPacketId,
    headSha: gitHead,
    diffDigest: canonicalDiffDigest,
    attempt: 1,
    status: options.status ?? "passed",
    generatedAt: timestamp,
    results: [
      {
        ...(options.context ?? {
          targetId: "home-desktop",
          name: "화면 1",
          route: "/",
          state: "default",
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
        }),
        baselineKind: options.visualBaseline ?? "figma",
        fixture: "고정된 검토 데이터",
        masks: [],
        status: options.status ?? "passed",
        metrics: {
          ...commonMetrics,
          ...(options.metrics ?? {}),
          pixelTolerance: 0.02,
          threshold: options.metrics?.threshold ?? 0.98,
        },
        baselineArtifactId: "art_22222222222222222222222222222222",
        actualArtifactId: "art_33333333333333333333333333333333",
        ...(options.includeDiff === false
          ? {}
          : { diffArtifactId: "art_44444444444444444444444444444444" }),
        ...(options.includeOverlay
          ? { overlayArtifactId: "art_88888888888888888888888888888888" }
          : {}),
      },
    ],
  };
  const visualReportArtifact = await writeArtifact({
    id: "art_55555555555555555555555555555555",
    kind: "visual-report",
    label: "visual-report.json",
    reportKind: "visual-report-v2-json",
    content: Buffer.from(`${JSON.stringify(visualReport, null, 2)}\n`),
    mediaType: "application/json",
    timestamp,
    metadata: {
      changeName: "home",
      decision: "passed",
      reviewPacketId: canonicalReviewPacketId,
      headSha: gitHead,
      diffDigest: canonicalDiffDigest,
    },
  });

  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...artifacts, visualReportArtifact],
      stages: run.stages.map((stage) =>
        stage.name === "implementation"
          ? {
              ...stage,
              checkpoint: {
                name: "implementation-complete",
                data: {
                  ...stage.checkpoint?.data,
                  reviewPacket: canonicalImplementationReviewPacket(run.id),
                },
                updatedAt: timestamp,
              },
            }
          : stage,
      ),
    },
    run.revision,
  );
}

async function addNewerUnboundVisualReport(runId: string): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:01.000Z";
  const artifact = await writeArtifact({
    id: "art_99999999999999999999999999999999",
    kind: "visual-report",
    label: "unbound-newer-report.png",
    reportKind: "visual-report-v2-json",
    content: Buffer.from(
      `${JSON.stringify({
        version: 2,
        runId,
        reviewPacketId: `packet_${"e".repeat(64)}`,
        headSha: gitHead,
        diffDigest: canonicalDiffDigest,
        attempt: 2,
        status: "passed",
        generatedAt: timestamp,
        results: [],
      })}\n`,
    ),
    mediaType: "application/json",
    timestamp,
    metadata: {
      reviewPacketId: `packet_${"e".repeat(64)}`,
      headSha: gitHead,
      diffDigest: canonicalDiffDigest,
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
}

async function appendSecondVisualTarget(runId: string): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:00.800Z";
  const baseline = await writeArtifact({
    id: createArtifactId(),
    kind: "figma-screenshot",
    label: "figma-second.png",
    reportKind: "figma-screenshot",
    content: Buffer.from("figma-second-png"),
    mediaType: "image/png",
    timestamp,
  });
  const current = await writeArtifact({
    id: createArtifactId(),
    kind: "screenshot",
    label: "browser-second.png",
    reportKind: "browser-screenshot",
    content: Buffer.from("browser-second-png"),
    mediaType: "image/png",
    timestamp,
  });
  const diff = await writeArtifact({
    id: createArtifactId(),
    kind: "visual-diff",
    label: "diff-second.png",
    reportKind: "visual-diff",
    content: Buffer.from("diff-second-png"),
    mediaType: "image/png",
    timestamp,
  });
  const visualReportArtifact = run.artifacts.find(
    (artifact) => artifact.id === "art_55555555555555555555555555555555",
  );
  if (visualReportArtifact === undefined) throw new Error("Visual report fixture is incomplete");
  const visualReport = JSON.parse(
    (await artifactStore.readContent(visualReportArtifact.digest)).toString("utf8"),
  ) as { results: unknown[] };
  visualReport.results.push({
    targetId: "second-screen",
    name: "화면 2",
    route: "/second",
    state: "default",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    baselineKind: "figma",
    fixture: "두 번째 검토 데이터",
    masks: [],
    status: "passed",
    metrics: {
      width: 100,
      height: 100,
      comparedPixelCount: 10_000,
      maskedPixelCount: 0,
      maskedAreaRatio: 0,
      exactMatchRatio: 0.99,
      reviewMatchRatio: 0.99,
      meanDistance: 0.1,
      maxDistance: 1,
      pixelTolerance: 0.02,
      threshold: 0.98,
    },
    baselineArtifactId: baseline.id,
    actualArtifactId: current.id,
    diffArtifactId: diff.id,
  });
  const blob = await artifactStore.writeBlob({
    content: Buffer.from(`${JSON.stringify(visualReport, null, 2)}\n`),
    mediaType: "application/json",
    storedAt: timestamp,
    label: visualReportArtifact.metadata["label"] as string,
  });
  const updatedReport = ArtifactRefSchema.parse({
    ...visualReportArtifact,
    uri: blob.uri,
    digest: blob.digest,
    createdAt: timestamp,
  });

  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [
        ...run.artifacts.map((artifact) =>
          artifact.id === updatedReport.id ? updatedReport : artifact,
        ),
        baseline,
        current,
        diff,
      ],
    },
    run.revision,
  );
}

async function bindVisualEvidenceToCommittedFiles(runId: string): Promise<void> {
  const visualDirectory = path.join(projectRoot, ".spec-to-pr", "shop", "visual");
  await mkdir(visualDirectory, { recursive: true });
  await writeFile(path.join(visualDirectory, "legacy.png"), Buffer.from("figma-png"));
  await writeFile(path.join(visualDirectory, "current.png"), Buffer.from("browser-png"));

  const run = await store.get(runId);
  const baseline = run.artifacts.find(
    (artifact) => artifact.id === "art_22222222222222222222222222222222",
  );
  const actual = run.artifacts.find(
    (artifact) => artifact.id === "art_33333333333333333333333333333333",
  );
  if (baseline === undefined || actual === undefined) {
    throw new Error("Visual evidence fixture is incomplete");
  }

  const sourceBaseline = ArtifactRefSchema.parse({
    ...baseline,
    id: "art_77777777777777777777777777777777",
    metadata: {
      ...baseline.metadata,
      projectRelativePath: ".spec-to-pr/shop/visual/legacy.png",
    },
  });
  const linkedBaseline = ArtifactRefSchema.parse({
    ...baseline,
    metadata: {
      ...baseline.metadata,
      projectRelativePath: "visual/home-desktop.baseline.png",
      sourceArtifactId: sourceBaseline.id,
      headSha: gitHead,
    },
  });
  const linkedActual = ArtifactRefSchema.parse({
    ...actual,
    metadata: {
      ...actual.metadata,
      projectRelativePath: ".spec-to-pr/shop/visual/current.png",
      headSha: gitHead,
    },
  });

  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: "2026-06-23T00:00:00.800Z",
      artifacts: [
        ...run.artifacts.map((artifact) => {
          if (artifact.id === linkedBaseline.id) return linkedBaseline;
          if (artifact.id === linkedActual.id) return linkedActual;
          return artifact;
        }),
        sourceBaseline,
      ],
    },
    run.revision,
  );
}

function createGitLabRawFallbackService(
  options: {
    treeMode?: "100644" | "120000";
    headBlobContents?: Record<string, string>;
  } = {},
): PublisherService {
  return new PublisherService(
    store,
    artifactStore,
    () => "2026-06-23T00:00:02.000Z",
    { github: githubPublisher, gitlab: gitlabPublisher },
    async (_cwd, args) => {
      gitCalls.push(args);
      if (args[0] === "status") return { stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { stdout: "1\n", stderr: "" };
      if (args[0] === "symbolic-ref") return { stdout: `${gitCurrentBranch}\n`, stderr: "" };
      if (args[0] === "rev-parse") return { stdout: `${gitHead}\n`, stderr: "" };
      if (args[0] === "ls-tree") {
        return {
          stdout: `${options.treeMode ?? "100644"} blob ${"b".repeat(40)}\t${args.at(-1)}\n`,
          stderr: "",
        };
      }
      if (args[0] === "cat-file") {
        const objectName = args[2] ?? "";
        const separator = objectName.indexOf(":");
        const projectRelativePath = separator < 0 ? "" : objectName.slice(separator + 1);
        const defaultContent = projectRelativePath.endsWith("legacy.png")
          ? "figma-png"
          : "browser-png";

        return {
          stdout: options.headBlobContents?.[projectRelativePath] ?? defaultContent,
          stderr: "",
        };
      }

      return { stdout: "https://gitlab.com/acme/spec-to-pr.git\n", stderr: "" };
    },
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
  public readonly uploadedAssetIds: string[][] = [];
  public readonly receivedSignals: Array<AbortSignal | undefined> = [];
  public failCreate = false;
  public failAssetUpload = false;
  public assetUploadError: Error | undefined;
  public visualAssetsEmbeddable = true;
  public existingRequest: PublishedReviewRequest | undefined;
  public forceNonDraftResult = false;
  public remoteBodyOverride: string | undefined;
  public assetOutcomePlan:
    | ((input: { invocation: number; assets: ReviewRequestAsset[] }) => ReviewAssetPublishOutcome[])
    | undefined;

  public constructor(private readonly host: "github" | "gitlab") {}

  public async findExisting(input: {
    signal?: AbortSignal;
  }): Promise<PublishedReviewRequest | undefined> {
    this.receivedSignals.push(input.signal);
    return this.existingRequest;
  }

  public async publishAssets(input: {
    assets: ReviewRequestAsset[];
  }): Promise<ReviewAssetPublishOutcome[]> {
    if (this.assetUploadError !== undefined) {
      throw this.assetUploadError;
    }
    if (this.failAssetUpload) {
      return input.assets.map((asset) => ({
        status: "failed",
        artifactId: asset.artifactId,
        failure: "uncertain",
        message: "forced visual evidence upload failure",
      }));
    }

    this.uploadedAssets.push(input.assets.map((asset) => ({ role: asset.role })));
    this.uploadedAssetIds.push(input.assets.map((asset) => asset.artifactId));

    const invocation = this.uploadedAssetIds.length;
    return (
      this.assetOutcomePlan?.({ invocation, assets: input.assets }) ??
      input.assets.map((asset) => this.publishedOutcome(asset))
    );
  }

  public publishedOutcome(asset: ReviewRequestAsset): ReviewAssetPublishOutcome {
    return {
      status: "published",
      asset: {
        artifactId: asset.artifactId,
        artifactDigest: asset.artifactDigest,
        role: asset.role,
        targetId: asset.targetId,
        label: asset.label,
        url: `https://github.example/assets/${asset.role}${
          asset.role === "e2e-video" ? ".webm" : ".png"
        }`,
        embeddable: asset.role !== "e2e-video" && this.visualAssetsEmbeddable,
      },
    };
  }

  public async readBody(): Promise<string> {
    return (
      this.remoteBodyOverride ??
      this.updatedBodies.at(-1) ??
      this.createdPayloads.at(-1)?.body ??
      ""
    );
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
