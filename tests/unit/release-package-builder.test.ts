import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleasePackageBuilder } from "../../src/release/index.js";

let directory: string;
let projectRoot: string;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-builder-"));
  projectRoot = path.join(directory, "project");

  await writeFixtureProject(projectRoot);
  await commitFixtureProject(projectRoot);
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
      ".codex/agents/spec-to-pr-functional-reviewer.toml",
      ".mcp.json",
      "CHANGELOG.md",
      "agents/design-reviewer.md",
      "dist/mcp/server.js",
      "package.json",
      "packages/codex-sdk/README.md",
      "packages/codex-sdk/package.json",
      "schemas/runtime/run-summary.schema.json",
      "skills/prepare-release/SKILL.md",
    ]);
    expect(first.sha256).toBe(second.sha256);
    expect(first.gitCommit).toMatch(/^[a-f0-9]{40}$/);
    await expect(readFile(first.packagePath)).resolves.toEqual(await readFile(second.packagePath));
  });

  it("rejects a dirty tree by default and keeps an explicit local dry-run deterministic", async () => {
    const builder = new ReleasePackageBuilder(projectRoot);
    const original = await builder.build({
      version: "0.1.0",
      outputDirectory: path.join(directory, "release-a"),
    });

    await writeFile(path.join(projectRoot, "dist/mcp/server.js"), "tampered workspace\n", "utf8");
    await mkdir(path.join(projectRoot, "skills/untracked"), { recursive: true });
    await writeFile(path.join(projectRoot, "skills/untracked/SKILL.md"), "# Untracked\n", "utf8");

    await expect(
      builder.build({
        version: "0.1.0",
        outputDirectory: path.join(directory, "release-b"),
      }),
    ).rejects.toThrow("Release build requires a clean worktree");

    const dirty = await builder.build({
      version: "0.1.0",
      outputDirectory: path.join(directory, "release-b"),
      allowDirty: true,
    });

    expect(dirty.sha256).toBe(original.sha256);
    expect(dirty.includedFiles).not.toContain("skills/untracked/SKILL.md");
  });
});

async function commitFixtureProject(root: string): Promise<void> {
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Release Test"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "release@example.test"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
}

async function writeFixtureProject(root: string): Promise<void> {
  const files = new Map<string, string>([
    [".claude-plugin/marketplace.json", "{}\n"],
    [".claude-plugin/plugin.json", "{}\n"],
    [".codex/agents/spec-to-pr-functional-reviewer.toml", 'name = "functional-reviewer"\n'],
    [".codex-plugin/plugin.json", "{}\n"],
    [".agents/plugins/marketplace.json", "{}\n"],
    [".mcp.json", "{}\n"],
    ["CHANGELOG.md", "# Changelog\n"],
    ["dist/mcp/server.js", "console.log('server');\n"],
    ["package.json", '{"name":"fixture"}\n'],
    ["packages/codex-sdk/README.md", "# SDK\n"],
    ["packages/codex-sdk/package.json", '{"name":"@spec-to-pr/codex-sdk-runner"}\n'],
    ["packages/codex-sdk/pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
    ["packages/codex-sdk/src/cli.ts", "export {};\n"],
    ["packages/codex-sdk/src/spec-to-pr-runner.ts", "export {};\n"],
    ["packages/codex-sdk/src/workflow-policy.ts", "export {};\n"],
    ["packages/codex-sdk/tsconfig.json", "{}\n"],
    ["scripts/validate-codex-plugin.ts", "export {};\n"],
    ["skills/prepare-release/SKILL.md", "# Skill\n"],
    ["agents/design-reviewer.md", "# Design Reviewer\n"],
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
