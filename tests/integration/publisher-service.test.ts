import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { PrReportService } from "../../src/application/pr-report-service.js";
import { PublisherService } from "../../src/application/publisher-service.js";
import { RunService } from "../../src/application/run-service.js";
import type {
  PublishedReviewRequest,
  PublishTarget,
  ReviewRequestPayload,
  ReviewRequestPublisher,
} from "../../src/publisher/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let prReportService: PrReportService;
let publisherService: PublisherService;
let originalGithubToken: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-publisher-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });

  originalGithubToken = process.env["GITHUB_TOKEN"];
  process.env["GITHUB_TOKEN"] = "ghp_test_token";

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  const artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));

  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  prReportService = new PrReportService(store, artifactStore, () => "2026-06-23T00:00:01.000Z");
  publisherService = new PublisherService(
    store,
    artifactStore,
    () => "2026-06-23T00:00:02.000Z",
    {
      github: new FakePublisher("github"),
      gitlab: new FakePublisher("gitlab"),
    },
    async () => ({
      stdout: "https://github.com/acme/spec-to-pr.git\n",
      stderr: "",
    }),
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
  it("plans publishes records result and stores publisher review", async () => {
    const run = await runService.createRun({
      projectRoot,
    });
    await markRunReadyForPublish(run.id);

    const report = await prReportService.generatePrReport({
      runId: run.id,
    });

    expect(report.decision).toBe("ready");

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

    const published = await publisherService.publish({
      runId: run.id,
      reportArtifactId: report.markdownArtifactId,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      pushBranch: false,
      confirm: true,
    });

    expect(published.result).toMatchObject({
      status: "passed",
      request: {
        url: "https://github.com/acme/spec-to-pr/pull/123",
        draft: true,
      },
    });
    expect(published.agentResultId).toMatch(/^ar_/);

    const loadedResult = await publisherService.getResult({
      runId: run.id,
      artifactId: published.publishResultArtifactId,
    });

    expect(loadedResult.result.status).toBe("passed");

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
    });
    expect(blocked.agentResultId).toBeUndefined();

    const loadedRun = await store.get(run.id);

    expect(loadedRun.agentResults.some((result) => result.kind === "publishing")).toBe(false);
  });
});

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
  ];

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
          producedBy: "evidence-verifier",
          evidenceIds: [],
          createdAt: timestamp,
          metadata: {
            reportKind: "verification-report",
          },
        },
      ],
      agentResults: [
        ...run.agentResults,
        {
          schemaVersion: "0.1.0",
          id: "ar_11111111111111111111111111111111",
          runId: run.id,
          kind: "verification",
          agent: "evidence-verifier",
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

class FakePublisher implements ReviewRequestPublisher {
  public constructor(private readonly host: "github" | "gitlab") {}

  public async findExisting(): Promise<PublishedReviewRequest | undefined> {
    return undefined;
  }

  public async create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest> {
    return {
      host: this.host,
      url:
        this.host === "github"
          ? "https://github.com/acme/spec-to-pr/pull/123"
          : "https://gitlab.com/acme/spec-to-pr/-/merge_requests/123",
      number: "123",
      id: "123",
      draft: input.payload.mode === "draft",
      sourceBranch: input.payload.sourceBranch,
      targetBranch: input.payload.targetBranch,
      created: true,
      updated: false,
    };
  }

  public async updateBody(input: {
    target: PublishTarget;
    requestNumber: string;
    body: string;
    token: string;
  }): Promise<PublishedReviewRequest> {
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
