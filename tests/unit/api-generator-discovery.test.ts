import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverApiGenerator } from "../../src/api-pipeline/api-generator-discovery.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-api-discovery-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("discoverApiGenerator", () => {
  it("uses a preferred command first", async () => {
    const plan = await discoverApiGenerator({
      projectRoot: directory,
      sourceKey: "staff",
      preferredCommand: ["pnpm", "run", "api:generate:staff"],
    });

    expect(plan).toMatchObject({
      mode: "existing-generator",
      generatorName: "preferred-command",
      command: ["pnpm", "run", "api:generate:staff"],
    });
  });

  it("detects package api generation scripts", async () => {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        scripts: {
          "api:generate:staff": "node scripts/generate-api.js",
        },
      }),
    );

    const plan = await discoverApiGenerator({
      projectRoot: directory,
      sourceKey: "staff",
    });

    expect(plan).toMatchObject({
      mode: "existing-generator",
      generatorName: "package-script:api:generate:staff",
    });
  });

  it("falls back when no existing generator is found", async () => {
    const plan = await discoverApiGenerator({
      projectRoot: directory,
      sourceKey: "staff",
    });

    expect(plan).toMatchObject({
      mode: "fallback-generator",
      generatedRoot: "src/shared/api/generated/staff",
    });
  });
});
