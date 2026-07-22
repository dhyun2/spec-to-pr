import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ReleasePackageBuilder,
  MCP_ENTRY_MAX_BYTES,
  MCP_TOTAL_JS_MAX_BYTES,
  validateMcpBundleFiles,
  verifyReleaseArchive,
  verifyReleasePackageFiles,
  verifyReviewerProfileParity,
  verifyReleaseVersionDeclarations,
} from "../../src/release/index.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("release verifier", () => {
  it("passes required plugin files", () => {
    const result = verifyReleasePackageFiles(requiredReleaseInventory());

    expect(result.status).toBe("passed");
  });

  it("requires the exact skill and reviewer inventory", () => {
    const withoutSkill = requiredReleaseInventory().filter(
      (file) => file !== "skills/review-design/SKILL.md",
    );
    const withObsoleteAgent = [...requiredReleaseInventory(), "agents/review-council.md"];
    const withMaintainerSkill = [
      ...requiredReleaseInventory(),
      ".agents/skills/prepare-release/SKILL.md",
    ];

    expect(verifyReleasePackageFiles(withoutSkill).failures).toContain(
      "Required skill missing: skills/review-design/SKILL.md",
    );
    expect(verifyReleasePackageFiles(withObsoleteAgent).failures).toContain(
      "Unexpected Markdown agent included: agents/review-council.md",
    );
    expect(verifyReleasePackageFiles(withMaintainerSkill).failures).toContain(
      "Maintainer-only skill included: .agents/skills/prepare-release/SKILL.md",
    );
  });

  it("rejects archive byte, checksum, entry, and commit mismatches", async () => {
    const root = await createArchiveFixture();
    const builder = new ReleasePackageBuilder(root);
    const build = await builder.build({
      version: "0.1.0",
      outputDirectory: path.join(root, "artifacts"),
    });
    const valid = await verifyReleaseArchive({
      projectRoot: root,
      packagePath: build.packagePath,
      expectedSha256: build.sha256,
      expectedFiles: build.includedFiles,
      expectedGitCommit: build.gitCommit,
      expectedVersion: "0.1.0",
      runtimeSmoke: false,
    });

    expect(valid.status).toBe("passed");

    const bytes = await readFile(build.packagePath);
    const tamperIndex = Math.floor(bytes.length / 2);
    bytes[tamperIndex] = bytes[tamperIndex]! ^ 0xff;
    await writeFile(build.packagePath, bytes);

    const tampered = await verifyReleaseArchive({
      projectRoot: root,
      packagePath: build.packagePath,
      expectedSha256: build.sha256,
      expectedFiles: [...build.includedFiles, "skills/obsolete/SKILL.md"],
      expectedGitCommit: "0".repeat(40),
      expectedVersion: "0.1.0",
      runtimeSmoke: false,
    });

    expect(tampered.status).toBe("failed");
    expect(tampered.failures.some((failure) => failure.includes("checksum"))).toBe(true);
    expect(tampered.failures.some((failure) => failure.includes("entries"))).toBe(true);
    expect(tampered.failures.some((failure) => failure.includes("commit"))).toBe(true);
  });

  it("validates semver and every release version declaration", () => {
    const declarations = new Map<string, Buffer>([
      ["package.json", Buffer.from('{"version":"0.1.0"}')],
      ["packages/codex-sdk/package.json", Buffer.from('{"version":"0.1.0"}')],
      [".claude-plugin/plugin.json", Buffer.from('{"version":"0.1.0"}')],
      [".codex-plugin/plugin.json", Buffer.from('{"version":"0.1.0"}')],
      [
        ".claude-plugin/marketplace.json",
        Buffer.from(
          '{"version":"0.1.0","plugins":[{"version":"0.1.0","source":{"ref":"spec-to-pr--v0.1.0"}}]}',
        ),
      ],
    ]);

    expect(verifyReleaseVersionDeclarations(declarations, "0.1.0")).toEqual([]);
    expect(verifyReleaseVersionDeclarations(declarations, "next")).toContain(
      "Release version must be valid semver: next",
    );

    declarations.set(".codex-plugin/plugin.json", Buffer.from('{"version":"0.2.0"}'));
    expect(verifyReleaseVersionDeclarations(declarations, "0.1.0")).toContain(
      ".codex-plugin/plugin.json declares version 0.2.0; expected 0.1.0.",
    );
  });

  it("requires Markdown and Codex reviewer profiles to carry the same safety invariants", () => {
    const shared =
      "immutable review packet token pressure scope split every reviewed requirement visual baseline";
    const files = new Map<string, Buffer>([
      ["agents/design-reviewer.md", Buffer.from(`${shared} every required design gate`)],
      [
        ".codex/agents/spec-to-pr-design-reviewer.toml",
        Buffer.from(`${shared} every required design gate`),
      ],
      [
        "agents/functional-reviewer.md",
        Buffer.from(
          "immutable review packet token pressure scope split every required functional gate every reviewed requirement playwright 25 MB",
        ),
      ],
      [
        ".codex/agents/spec-to-pr-functional-reviewer.toml",
        Buffer.from(
          "immutable review packet scope split every required functional gate every reviewed requirement playwright 25 MB",
        ),
      ],
    ]);

    expect(verifyReviewerProfileParity(files)).toContain(
      "Reviewer profile parity missing 'token pressure' for functional reviewer.",
    );
  });

  it("requires both Codex reviewers to disable inherited MCP servers", () => {
    const functionalMarkers =
      "immutable review packet token pressure scope split every required functional gate every reviewed requirement playwright 25 mb read-only never edit implementation workflow mcp mcp_servers = {}";
    const designMarkers =
      "immutable review packet token pressure scope split every required design gate every reviewed requirement visual baseline read-only never edit implementation workflow mcp mcp_servers = {}";
    const files = new Map<string, Buffer>([
      ["agents/design-reviewer.md", Buffer.from(designMarkers)],
      [".codex/agents/spec-to-pr-design-reviewer.toml", Buffer.from(designMarkers)],
      ["agents/functional-reviewer.md", Buffer.from(functionalMarkers)],
      [
        ".codex/agents/spec-to-pr-functional-reviewer.toml",
        Buffer.from(functionalMarkers.replace(" mcp_servers = {}", "")),
      ],
    ]);

    expect(verifyReviewerProfileParity(files)).toContain(
      "Reviewer Codex profile missing 'mcp_servers = {}' for functional reviewer.",
    );
  });

  it("rejects forbidden files", () => {
    const result = verifyReleasePackageFiles([
      ...requiredReleaseInventory(),
      "node_modules/foo/index.js",
    ]);

    expect(result.status).toBe("failed");
    expect(result.failures.some((failure) => failure.includes("node_modules"))).toBe(true);
  });

  it("requires every MCP chunk, validates local imports, and enforces size budgets", () => {
    expect(
      validateMcpBundleFiles(
        new Map([
          ["dist/mcp/server.js", Buffer.from('import("./png-CODEC.js");')],
          ["dist/mcp/png-CODEC.js", Buffer.from("export {};\n")],
        ]),
      ),
    ).toEqual([]);
    expect(
      validateMcpBundleFiles(
        new Map([["dist/mcp/server.js", Buffer.from('import("./missing.js");')]]),
      ),
    ).toContain("MCP local import is missing from the package: dist/mcp/server.js -> ./missing.js");
    expect(
      validateMcpBundleFiles(
        new Map([
          [
            "dist/mcp/server.js",
            Buffer.from("const parserMessage = 'Only import x from \"./module\" is valid.';\n"),
          ],
        ]),
      ),
    ).toEqual([]);
    expect(
      validateMcpBundleFiles(
        new Map([["dist/mcp/server.js", Buffer.from('export * from "./missing.js";')]]),
      ),
    ).toContain("MCP local import is missing from the package: dist/mcp/server.js -> ./missing.js");
    expect(
      validateMcpBundleFiles(
        new Map([["dist/mcp/server.js", Buffer.alloc(MCP_ENTRY_MAX_BYTES + 1)]]),
      ).some((failure) => failure.includes("MCP entry uses")),
    ).toBe(true);
    expect(
      validateMcpBundleFiles(
        new Map([
          ["dist/mcp/server.js", Buffer.from("export {};\n")],
          ["dist/mcp/huge.js", Buffer.alloc(MCP_TOTAL_JS_MAX_BYTES)],
        ]),
      ).some((failure) => failure.includes("MCP JavaScript uses")),
    ).toBe(true);
  });
});

function requiredReleaseInventory(): string[] {
  return [
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    ".claude-plugin/plugin.json",
    ".codex/agents/spec-to-pr-design-reviewer.toml",
    ".codex/agents/spec-to-pr-functional-reviewer.toml",
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "CHANGELOG.md",
    "agents/design-reviewer.md",
    "agents/functional-reviewer.md",
    "dist/mcp/chunk-TEST1234.js",
    "dist/mcp/server.js",
    "package.json",
    "packages/codex-sdk/dist/boundary-runner.d.ts",
    "packages/codex-sdk/dist/boundary-runner.js",
    "packages/codex-sdk/dist/cli.d.ts",
    "packages/codex-sdk/dist/cli.js",
    "packages/codex-sdk/dist/generated/delivery-mode-policy.d.ts",
    "packages/codex-sdk/dist/generated/delivery-mode-policy.js",
    "packages/codex-sdk/dist/spec-to-pr-runner.d.ts",
    "packages/codex-sdk/dist/spec-to-pr-runner.js",
    "packages/codex-sdk/dist/usage-calibration.d.ts",
    "packages/codex-sdk/dist/usage-calibration.js",
    "packages/codex-sdk/dist/workflow-policy.d.ts",
    "packages/codex-sdk/dist/workflow-policy.js",
    "packages/codex-sdk/dist/workload-budget.d.ts",
    "packages/codex-sdk/dist/workload-budget.js",
    "packages/codex-sdk/package.json",
    "schemas/runtime/index.json",
    "schemas/runtime/agent-result.schema.json",
    "schemas/runtime/artifact-ref.schema.json",
    "schemas/runtime/check-result.schema.json",
    "schemas/runtime/decision.schema.json",
    "schemas/runtime/evidence-ref.schema.json",
    "schemas/runtime/gap.schema.json",
    "schemas/runtime/run-manifest.schema.json",
    "schemas/runtime/run-summary.schema.json",
    "schemas/runtime/source-ref.schema.json",
    "skills/archive-openspec/SKILL.md",
    "skills/doctor/SKILL.md",
    "skills/implement/SKILL.md",
    "skills/intake-contracts/SKILL.md",
    "skills/publish/SKILL.md",
    "skills/review-design/SKILL.md",
    "skills/review-functional/SKILL.md",
    "skills/spec-to-pr/SKILL.md",
  ];
}

async function createArchiveFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-release-archive-"));
  temporaryDirectories.push(directory);
  const files = new Map<string, string>([
    ["package.json", '{"version":"0.1.0"}\n'],
    ["packages/codex-sdk/package.json", '{"version":"0.1.0"}\n'],
    [".claude-plugin/plugin.json", '{"version":"0.1.0"}\n'],
    [".codex-plugin/plugin.json", '{"version":"0.1.0"}\n'],
    [
      ".claude-plugin/marketplace.json",
      '{"version":"0.1.0","plugins":[{"version":"0.1.0","source":{"ref":"spec-to-pr--v0.1.0"}}]}\n',
    ],
    [".agents/plugins/marketplace.json", "{}\n"],
    [".mcp.json", "{}\n"],
    ["CHANGELOG.md", "# Changelog\n"],
    ["dist/mcp/server.js", 'import "./chunk-TEST1234.js";\n'],
    ["dist/mcp/chunk-TEST1234.js", "export {};\n"],
  ]);

  for (const [file, content] of files) {
    const absolute = path.join(directory, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await execFileAsync("git", ["config", "user.name", "Release Test"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "release@example.test"], {
    cwd: directory,
  });
  await execFileAsync("git", ["add", "."], { cwd: directory });
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: directory });
  return directory;
}
