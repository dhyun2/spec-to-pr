import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { FigmaCapabilityService } from "../../src/application/figma-capability-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let runService: RunService;
let service: FigmaCapabilityService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-figma-cap-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
  });
  service = new FigmaCapabilityService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("FigmaCapabilityService", () => {
  it("records capability report and provider policy", async () => {
    const run = await runService.createRun({
      projectRoot: directory,
    });

    const result = await service.recordCapabilities({
      runId: run.id,
      providers: [
        {
          providerId: "figma-local",
          available: true,
          rawToolNames: ["get_metadata", "get_screenshot"],
        },
        {
          providerId: "figma-remote",
          available: true,
          rawToolNames: ["get_design_context", "get_variable_defs"],
        },
      ],
    });

    expect(result.artifact.kind).toBe("figma-mcp-capability-report");
    expect(result.report.policy.metadataProviderId).toBe("figma-local");
    expect(result.report.policy.designContextProviderId).toBe("figma-remote");

    const policy = await service.getProviderPolicy({
      runId: run.id,
    });

    expect(policy.metadataProviderId).toBe("figma-local");
  });
});
