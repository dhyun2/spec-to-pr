import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleasePackageBuilder, verifyReleasePackageRuntime } from "../../src/release/index.js";

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
    expect(verification.kernelInfo).toMatchObject({
      pluginName: "spec-to-pr",
      transport: "stdio",
    });
    expect(verification.kernelPing).toMatchObject({
      echo: "release-smoke",
    });
  });
});
