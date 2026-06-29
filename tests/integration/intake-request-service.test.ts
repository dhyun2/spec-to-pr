import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import { RunService } from "../../src/application/run-service.js";
import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let intakeRequestService: IntakeRequestService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-intake-request-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));

  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-29T00:00:00.000Z",
  });

  intakeRequestService = new IntakeRequestService(
    store,
    new SourceSnapshotStore(path.join(dataRoot, "source-snapshots")),
    new ArtifactBlobStore(path.join(dataRoot, "artifacts")),
    () => "2026-06-29T00:00:00.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("IntakeRequestService", () => {
  it("snapshots the user request as instruction evidence and parses workflow hints", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const requestText = [
      "spec to pr 사용해서 docs/plan.md docs/api.yaml 읽고 시작해줘.",
      "Figma: https://www.figma.com/design/abc123/Mapfinder?node-id=1-2",
      "source branch feat/mapfinder/init, target branch master.",
      "pnpm test && pnpm build 로 검증해야 하고 PR/MR은 바로 publish 해도 되지만 merge 하지마.",
      "OpenSpec archive도 merge 전에는 하지 마.",
    ].join("\n");

    const result = await intakeRequestService.parseIntakeRequest({
      runId: run.id,
      requestText,
      label: "initial-user-request",
    });

    expect(result.source.kind).toBe("instruction");
    expect(result.source.locator).toMatchObject({
      type: "inline",
      label: "initial-user-request",
      mediaType: "text/plain; charset=utf-8",
    });
    expect(result.evidence.location).toMatchObject({
      type: "inline-text",
      label: "initial-user-request",
    });
    expect(result.parsed.figmaUrls).toEqual([
      "https://www.figma.com/design/abc123/Mapfinder?node-id=1-2",
    ]);
    expect(result.parsed.filePaths).toEqual(["docs/plan.md", "docs/api.yaml"]);
    expect(result.parsed.branchPolicy).toMatchObject({
      sourceBranch: "feat/mapfinder/init",
      targetBranch: "master",
    });
    expect(result.parsed.validationCommands).toContain("pnpm test && pnpm build");
    expect(result.parsed.publishPolicy).toMatchObject({
      shouldPublish: true,
      mergeAllowed: false,
    });
    expect(result.parsed.archivePolicy).toMatchObject({
      archiveAllowed: false,
    });

    const loaded = await store.get(run.id);

    expect(loaded.sources).toHaveLength(1);
    expect(loaded.evidence).toHaveLength(1);
    expect(loaded.artifacts).toHaveLength(1);
    expect(loaded.revision).toBe(1);
    expect(loaded.artifacts[0]?.kind).toBe("parsed-intake-request");
    expect(loaded.artifacts[0]?.evidenceIds).toEqual([result.evidence.id]);
  });

  it("parses app targets inline endpoint notes and Korean branch hints from natural language", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const requestText = [
      "apps/rangepro 레슨권 등록 화면 작업해줘. docs 폴더의 plan.md도 참고.",
      "API는 GET /members, POST /members/{userNo}, DELETE /members/{userNo}/lesson-vouchers 사용.",
      "qa인 지금 브렌치로 MR 올려도 되는데 diff 이미지는 MR 본문에 넣지 말고 artifact로만 남겨.",
    ].join("\n");

    const result = await intakeRequestService.parseIntakeRequest({
      runId: run.id,
      requestText,
    });

    expect(result.parsed.filePaths).toEqual(expect.arrayContaining(["apps/rangepro", "plan.md"]));
    expect(result.parsed.inlineOpenApiBlocks[0]).toContain("GET /members");
    expect(result.parsed.inlineOpenApiBlocks[0]).toContain("POST /members/{userNo}");
    expect(result.parsed.branchPolicy).toMatchObject({
      targetBranch: "qa",
    });
    expect(result.parsed.visualPreviewPolicy).toMatchObject({
      includeDiff: false,
    });
  });
});
