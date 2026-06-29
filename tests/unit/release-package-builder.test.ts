import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleasePackageBuilder } from "../../src/release/index.js";

let directory: string;
let projectRoot: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-builder-"));
  projectRoot = path.join(directory, "project");

  await writeFixtureProject(projectRoot);
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("release package builder", () => {
  it("collects only allowlisted files and builds deterministic zips", async () => {
    const builder = new ReleasePackageBuilder(projectRoot);
    const first = await builder.build({
      version: "0.1.0",
      outputDirectory: path.join(directory, "release-a"),
    });
    const second = await builder.build({
      version: "0.1.0",
      outputDirectory: path.join(directory, "release-b"),
    });

    expect(first.includedFiles).toEqual([
      ".agents/plugins/marketplace.json",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".codex/agents/spec-to-pr-visual-regression-reviewer.toml",
      ".mcp.json",
      "CHANGELOG.md",
      "agents/release-reviewer.md",
      "dist/mcp/server.js",
      "docs/codex/README.md",
      "package.json",
      "packages/codex-sdk/README.md",
      "packages/codex-sdk/package.json",
      "packages/codex-sdk/pnpm-lock.yaml",
      "packages/codex-sdk/src/cli.ts",
      "packages/codex-sdk/src/spec-to-pr-runner.ts",
      "packages/codex-sdk/src/workflow-policy.ts",
      "packages/codex-sdk/tsconfig.json",
      "schemas/runtime/run-summary.schema.json",
      "scripts/validate-codex-plugin.ts",
      "skills/prepare-release/SKILL.md",
    ]);
    expect(first.sha256).toBe(second.sha256);
    await expect(readFile(first.packagePath)).resolves.toEqual(await readFile(second.packagePath));
  });
});

async function writeFixtureProject(root: string): Promise<void> {
  const files = new Map<string, string>([
    [".claude-plugin/marketplace.json", "{}\n"],
    [".claude-plugin/plugin.json", "{}\n"],
    [".codex/agents/spec-to-pr-visual-regression-reviewer.toml", 'name = "reviewer"\n'],
    [".codex-plugin/plugin.json", "{}\n"],
    [".agents/plugins/marketplace.json", "{}\n"],
    [".mcp.json", "{}\n"],
    ["CHANGELOG.md", "# Changelog\n"],
    ["dist/mcp/server.js", "console.log('server');\n"],
    ["package.json", '{"name":"fixture"}\n'],
    ["docs/codex/README.md", "# Codex\n"],
    ["packages/codex-sdk/README.md", "# SDK\n"],
    ["packages/codex-sdk/package.json", '{"name":"@spec-to-pr/codex-sdk-runner"}\n'],
    ["packages/codex-sdk/pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
    ["packages/codex-sdk/src/cli.ts", "export {};\n"],
    ["packages/codex-sdk/src/spec-to-pr-runner.ts", "export {};\n"],
    ["packages/codex-sdk/src/workflow-policy.ts", "export {};\n"],
    ["packages/codex-sdk/tsconfig.json", "{}\n"],
    ["scripts/validate-codex-plugin.ts", "export {};\n"],
    ["skills/prepare-release/SKILL.md", "# Skill\n"],
    ["agents/release-reviewer.md", "# Agent\n"],
    ["schemas/runtime/run-summary.schema.json", "{}\n"],
    ["node_modules/pkg/index.js", "bad\n"],
    [".git/config", "bad\n"],
    [".env", "SECRET=bad\n"],
  ]);

  for (const [relativePath, content] of files) {
    const absolutePath = path.join(root, relativePath);

    await mkdir(path.dirname(absolutePath), {
      recursive: true,
    });
    await writeFile(absolutePath, content, "utf8");
  }
}
