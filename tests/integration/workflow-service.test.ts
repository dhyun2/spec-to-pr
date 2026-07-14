import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import type { OpenSpecArchiveService } from "../../src/application/openspec-archive-service.js";
import type { PublisherService } from "../../src/application/publisher-service.js";
import { RunService } from "../../src/application/run-service.js";
import { StageService } from "../../src/application/stage-service.js";
import {
  WorkflowService,
  type WorkflowServiceDependencies,
} from "../../src/application/workflow-service.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

const FIGMA_URL = "https://www.figma.com/design/abc/file?node-id=1-2";
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
      "visual/diff.png",
      "contracts/requirements.json",
      "contracts/legacy-baseline.md",
      "figma/design-context.json",
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
      path.join(directory, "test-results/api-contract.json"),
      JSON.stringify({ status: "passed" }),
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
      path.join(directory, ".gitignore"),
      "artifacts/\nsources/\nruns.sqlite3*\nprofiles/\n",
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

  it("reopens implementation and rejects stale review packets after changes are requested", async () => {
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
      (action) => action.kind === "review-design",
    )?.reviewPacketId;
    expect(packetId).toMatch(/^packet_[a-f0-9]{64}$/);
    if (packetId === undefined) throw new Error("Missing review packet");

    await changeSource(directory, "src/checkout.tsx", "mutated after packet creation\n");
    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "functional-review",
          reviewPacketId: packetId,
          verdict: "changes-requested",
          summary: "This packet is stale.",
          findings: [],
          requirements: [{ id: "checkout-state", verdict: "rejected" }],
          artifactPaths: ["test-results/unit.json"],
          gateResults: [],
        },
      }),
    ).rejects.toThrow(/packet.*stale|diff.*match/i);
    await changeSource(directory, "src/checkout.tsx", "implemented checkout state\n");

    await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        reviewPacketId: packetId,
        verdict: "approved",
        summary: "Design evidence passed.",
        findings: [],
        requirements: [{ id: "checkout-state", verdict: "accepted" }],
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
    const reopened = await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        reviewPacketId: packetId,
        verdict: "changes-requested",
        summary: "The empty-state behavior is incorrect.",
        findings: [{ severity: "major", title: "Wrong empty state", evidence: [] }],
        requirements: [{ id: "checkout-state", verdict: "rejected" }],
        artifactPaths: ["test-results/unit.json"],
        gateResults: [],
      },
    });

    expect(reopened.nextActions).toEqual([
      { kind: "implement", runId: started.runId, requireApiReady: false },
    ]);
    expect(reopened.stages.find((stage) => stage.name === "design-review")?.status).toBe("pending");

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
    });

    expect(tiny.workload.size).toBe("XS");
    expect(complex.workload.size).toBe("XL");
    expect(complex.requiredValidations).toEqual([
      "functional",
      "accessibility",
      "targeted-feature-e2e",
      "feature-video",
      "api-ready",
      "draft-publication-preflight",
    ]);
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

  it("records an explicit delivery profile without adding stages", async () => {
    const status = await service.start({
      projectRoot: directory,
      requestText: "Implement the supplied product brief",
      scope: "auto",
      mode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
    });

    expect(status.stages).toHaveLength(8);
    expect(status.deliveryProfile).toMatchObject({
      mode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "briefs/checkout.md",
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
          },
        },
      }),
    ).rejects.toThrow(/skill hint.*requested/i);
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

  it("blocks legacy contracts without a focused baseline", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Fix parsing behavior in the existing project",
      scope: "non-ui",
      mode: "legacy",
      changeKind: "fix",
      publication: "draft",
    });

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

    const accepted = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Captured current behavior and the requested delta.",
        artifactPaths: ["contracts/requirements.json", "contracts/legacy-baseline.md"],
        baselinePaths: ["contracts/legacy-baseline.md"],
        requirementManifest: requirements("legacy-fix"),
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
      },
    });

    expect(accepted.nextActions[0]?.kind).toBe("implement");
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
    expect(started.deliveryProfile.publication).toBe("none");

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
        nodeIds: ["1:2"],
        manifestPath: "figma/design-context.json",
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
          nodeIds: ["1:2"],
          manifestPath: "figma/design-context.json",
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

  it("requires a targeted feature E2E and exactly one video only in feature mode", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Add the user-facing checkout feature",
      scope: "ui",
      mode: "feature",
      changeKind: "feature",
      publication: "draft",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Feature contracts ready.",
        artifactPaths: ["contracts/requirements.json"],
        requirementManifest: requirements("checkout-feature"),
      },
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Feature implemented without targeted evidence.",
          apiReady: false,
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
      apiReady: false,
      uiChanged: true,
      changedFiles: ["src/checkout.tsx"],
      artifactPaths: [
        "test-results/contract.json",
        "test-results/checkout.json",
        "test-results/checkout.mp4",
      ],
      implementationContextId: FEATURE_CONTEXT_ID,
      featureEvidence: {
        scope: "targeted-feature",
        testSelector: "e2e/checkout.spec.ts",
        testCommand: "playwright test e2e/checkout.spec.ts",
        resultPath: "test-results/checkout.json",
        videoPath: "test-results/checkout.mp4",
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
      "review-design",
      "review-functional",
    ]);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        reviewPacketId: reviewPacketId(implemented, "review-design"),
        verdict: "approved",
        summary: "Feature design passed.",
        findings: [],
        requirements: [{ id: "checkout-feature", verdict: "accepted" }],
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
        ],
      },
    });
    await service.advance({ runId: started.runId, until: "report" });
    const report = await reportMarkdown(store, artifactStore, started.runId);
    expect(report).toContain("## Requirement traceability");
    expect(report).toContain("## Feature E2E video");
    expect(report).toContain("test-results/checkout.mp4");
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
      nodeIds: ["1:2"],
      manifestPath: "figma/design-context.json",
      artifactPaths: ["figma/design-context.json", "visual/diff.png"],
    } as const;

    await writeFile(path.join(directory, submission.manifestPath), "not json", "utf8");
    await expect(service.submit({ runId: started.runId, submission })).rejects.toThrow(
      /Figma manifest/i,
    );

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
        nodeIds: ["1:2"],
        manifestPath: "figma/design-context.json",
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
    expect(report).toContain("checkout-states");
    expect(report).toContain("Checkout \\| states");
    expect(report).toContain("Empty \\| loading<br>Success states render.");
    expect(report).toContain("checkout-submit");
    expect(report).toContain("src/checkout.tsx");
    expect(report).toMatch(/Diff digest: sha256:[a-f0-9]{64}/);
    expect(report).toContain("functional-review/functional: passed");
    expect(report).toContain("## Risks");
    expect(report).not.toContain("## Feature E2E video");
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
    },
  });
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
    nodeIds: ["1:2"],
    visualPaths: ["visual/diff.png"],
  };
}

function requirements(...ids: string[]) {
  return ids.map((id) => ({
    id,
    title: id.replaceAll("-", " "),
    acceptanceCriteria: [`${id} satisfies the declared behavior.`],
  }));
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
