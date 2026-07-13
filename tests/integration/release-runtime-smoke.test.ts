import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleasePackageBuilder, verifyReleasePackageRuntime } from "../../src/release/index.js";

const EXPECTED_TOOLS = [
  "workflow_advance",
  "workflow_archive",
  "workflow_info",
  "workflow_publish",
  "workflow_start",
  "workflow_status",
  "workflow_submit",
] as const;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-runtime-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("release runtime smoke", () => {
  it("starts the bundled MCP server from release files without plugin cache node_modules", async () => {
    const builder = new ReleasePackageBuilder(process.cwd());
    const build = await builder.build({
      version: "0.1.0",
      outputDirectory: path.join(directory, "release"),
    });
    const dataDirectory = path.join(directory, "data");

    await mkdir(dataDirectory, {
      recursive: true,
    });

    const verification = await verifyReleasePackageRuntime({
      projectRoot: process.cwd(),
      includedFiles: build.includedFiles,
      dataDirectory,
      timeoutMs: 5_000,
    });

    expect(verification.status).toBe("passed");
    expect(verification.workflowInfo).toMatchObject({
      pluginName: "spec-to-pr",
      transport: "stdio",
      contractVersion: "2.0.0",
    });
    expect(verification.toolNames).toEqual(EXPECTED_TOOLS);
    expect(verification.toolSchemaBytes).toBeLessThan(40_000);
    expect(verification.workflowStatus).toMatchObject({
      status: "needs-external-action",
      currentStage: "contracts",
    });
  });
});
