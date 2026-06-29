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
let artifactStore: ArtifactBlobStore;
let runService: RunService;
let prReportService: PrReportService;
let publisherService: PublisherService;
let originalGithubToken: string | undefined;
let githubPublisher: FakePublisher;
let gitlabPublisher: FakePublisher;

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
  prReportService = new PrReportService(store, artifactStore, () => "2026-06-23T00:00:01.000Z");
  githubPublisher = new FakePublisher("github");
  gitlabPublisher = new FakePublisher("gitlab");
  publisherService = new PublisherService(
    store,
    artifactStore,
    () => "2026-06-23T00:00:02.000Z",
    {
      github: githubPublisher,
      gitlab: gitlabPublisher,
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
    expect(plan.payload.body).toBe(reportBody.markdown);

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
    expect(githubPublisher.createdPayloads[0]?.body).toContain("## 시각 증거 미리보기");
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/figma.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/browser.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "https://github.example/assets/diff.png",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain(
      "art_22222222222222222222222222222222",
    );
    expect(githubPublisher.createdPayloads[0]?.body).toContain("# 요약");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("## 실행 메타데이터");
    expect(githubPublisher.createdPayloads[0]?.body).toContain("## 결정");

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
        observabilityArtifact,
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

async function addVisualEvidence(runId: string): Promise<void> {
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
    | "telemetry-config";
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

  public constructor(private readonly host: "github" | "gitlab") {}

  public async findExisting(): Promise<PublishedReviewRequest | undefined> {
    return undefined;
  }

  public async publishAssets() {
    return [
      {
        artifactId: "art_22222222222222222222222222222222",
        role: "figma" as const,
        targetId: "home-desktop",
        label: "Figma",
        url: "https://github.example/assets/figma.png",
      },
      {
        artifactId: "art_33333333333333333333333333333333",
        role: "browser" as const,
        targetId: "home-desktop",
        label: "Browser",
        url: "https://github.example/assets/browser.png",
      },
      {
        artifactId: "art_44444444444444444444444444444444",
        role: "diff" as const,
        targetId: "home-desktop",
        label: "Diff",
        url: "https://github.example/assets/diff.png",
      },
    ];
  }

  public async create(input: {
    target: PublishTarget;
    payload: ReviewRequestPayload;
    token: string;
  }): Promise<PublishedReviewRequest> {
    this.createdPayloads.push(input.payload);

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
    this.updatedBodies.push(input.body);

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
