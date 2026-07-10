import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { FigmaDesignInventoryService } from "../../src/application/figma-design-inventory-service.js";
import { FigmaIntakeService } from "../../src/application/figma-intake-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let runService: RunService;
let intake: FigmaIntakeService;
let inventory: FigmaDesignInventoryService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-figma-inventory-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  const artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));

  runService = new RunService(store, {
    pluginVersion: "0.1.0",
  });
  intake = new FigmaIntakeService(store, artifactStore);
  inventory = new FigmaDesignInventoryService(store, artifactStore);
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("FigmaDesignInventoryService", () => {
  it("creates inventory from recorded raw artifacts", async () => {
    const run = await runService.createRun({
      projectRoot: directory,
    });
    const source = await intake.registerFigmaSource({
      runId: run.id,
      url: "https://www.figma.com/design/abc123/Product?node-id=1-2",
    });

    await intake.recordTextArtifact({
      runId: run.id,
      sourceId: source.source.id,
      kind: "metadata",
      content: '<node id="1:2" name="Button / Primary" type="INSTANCE" />',
      mediaType: "application/xml",
    });

    await intake.recordTextArtifact({
      runId: run.id,
      sourceId: source.source.id,
      kind: "variable-defs",
      content: "variable color/primary variable spacing/4",
      mediaType: "text/plain",
    });

    await intake.recordTextArtifact({
      runId: run.id,
      sourceId: source.source.id,
      kind: "code-connect-map",
      content: JSON.stringify({
        nodeId: "1:2",
        componentName: "Button",
        source: "@/shared/ui/button",
      }),
      mediaType: "application/json",
    });

    const result = await inventory.analyze({
      runId: run.id,
      sourceId: source.source.id,
    });

    expect(result.inventory.components).toHaveLength(1);
    expect(result.inventory.components[0]?.mapped).toBe(true);
    expect(result.inventory.tokens.length).toBeGreaterThan(0);
    expect(result.artifact.kind).toBe("figma-design-inventory");

    const loaded = await inventory.getInventory({
      runId: run.id,
      sourceId: source.source.id,
    });

    expect(loaded.inventory.components[0]?.codeConnectComponent).toBe("Button");
    expect(loaded.providerComparisonArtifact?.kind).toBe("figma-provider-comparison");
  });
});
