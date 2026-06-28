import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { DesignContractService } from "../../src/application/design-contract-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let service: DesignContractService;

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const changeName = "deliver-reservation-management";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-design-contract-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(path.join(projectRoot, "src", "shared", "ui", "button"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, "src", "shared", "ui", "button", "index.tsx"),
    "export function Button() { return null; }",
  );

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(dataRoot, "artifacts"));
  service = new DesignContractService(store, artifactStore, () => now);
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("DesignContractService", () => {
  it("generates design contract files, summary, and artifacts", async () => {
    const run = createInitialRun(
      { sources: [] },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot,
        now,
      },
    );

    const inventory = {
      sourceId: "src_11111111111111111111111111111111",
      generatedAt: now,
      sourceArtifactIds: [],
      components: [
        {
          nodeId: "238:941",
          name: "Button",
          type: "INSTANCE",
          mapped: false,
          variantProperties: {},
        },
      ],
      tokens: [],
      assets: [],
      providerComparison: {
        comparedProviderIds: [],
        metadataMismatch: false,
        screenshotMissing: false,
        variableDefsMissing: false,
        codeConnectMissing: false,
        notes: [],
      },
      gapIds: [],
    };

    const blob = await artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: now,
      label: "figma-design-inventory",
    });

    const inventoryArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "figma-design-inventory",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "evidence-verifier",
      evidenceIds: [],
      createdAt: now,
      metadata: {},
    });

    await store.create({
      ...run,
      artifacts: [inventoryArtifact],
    });

    const result = await service.generate({
      runId: run.id,
      changeName,
      figmaInventoryArtifactId: inventoryArtifact.id,
    });

    expect(result.duplicate).toBe(false);
    expect(result.componentMappings).toBe(1);
    expect(result.changedFiles).toContain(
      "openspec/changes/deliver-reservation-management/artifacts/design-contract/figma-design-contract.json",
    );

    const contractContent = await readFile(
      path.join(
        projectRoot,
        "openspec",
        "changes",
        changeName,
        "artifacts",
        "design-contract",
        "figma-design-contract.json",
      ),
      "utf8",
    );

    expect(contractContent).toContain("figma-design-contract-v1");

    const summary = await service.getSummary({
      runId: run.id,
      changeName,
    });

    expect(summary.componentMappings).toBe(1);

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "figma-design-contract")).toBe(
      true,
    );
  });
});
