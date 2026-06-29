import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ClaudePluginManifestSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.literal("0.1.4"),
  license: z.literal("MIT"),
  skills: z.string().min(1),
  mcpServers: z.string().min(1),
});

const MarketplaceSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.literal("0.1.4"),
  plugins: z
    .array(
      z.object({
        name: z.literal("spec-to-pr"),
        version: z.literal("0.1.4"),
        license: z.literal("MIT"),
        source: z.object({
          source: z.literal("url"),
          url: z.literal("https://github.com/dhyun2/spec-to-pr.git"),
          ref: z.literal("spec-to-pr--v0.1.4"),
        }),
      }),
    )
    .length(1),
});

const CodexPluginManifestSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.literal("0.1.4"),
  license: z.literal("MIT"),
  skills: z.literal("./skills/"),
  mcpServers: z.object({
    "spec-to-pr": z.object({
      command: z.literal("node"),
      args: z.array(z.string().min(1)).min(1),
      env: z.object({
        SPEC_TO_PR_HOST: z.literal("codex"),
      }),
    }),
  }),
  interface: z.object({
    displayName: z.literal("Spec to PR"),
    category: z.literal("Developer Tools"),
    capabilities: z.array(z.string().min(1)).min(1),
    defaultPrompt: z.array(z.string().min(1)).min(1).max(3),
  }),
});

const CodexMarketplaceSchema = z.object({
  name: z.literal("spec-to-pr-local"),
  interface: z.object({
    displayName: z.literal("Spec to PR Local"),
  }),
  plugins: z
    .array(
      z.object({
        name: z.literal("spec-to-pr"),
        source: z.object({
          source: z.literal("local"),
          path: z.literal("./"),
        }),
        policy: z.object({
          installation: z.literal("AVAILABLE"),
          authentication: z.literal("ON_INSTALL"),
        }),
        category: z.literal("Developer Tools"),
      }),
    )
    .length(1),
});

const McpConfigSchema = z.object({
  mcpServers: z.object({
    "spec-to-pr": z.object({
      command: z.literal("node"),
      args: z.array(z.string().min(1)).min(1),
    }),
  }),
});

describe("plugin layout", () => {
  const root = process.cwd();

  it("declares valid plugin manifest paths", () => {
    const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
    const manifest = ClaudePluginManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );

    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");

    expect(existsSync(path.join(root, manifest.skills))).toBe(true);
    expect(existsSync(path.join(root, manifest.mcpServers))).toBe(true);
  });

  it("declares a marketplace entry for the release tag", () => {
    const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
    const manifest = ClaudePluginManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    const marketplacePath = path.join(root, ".claude-plugin", "marketplace.json");
    const marketplace = MarketplaceSchema.parse(JSON.parse(readFileSync(marketplacePath, "utf8")));
    const plugin = marketplace.plugins[0]!;

    expect(plugin.version).toBe(manifest.version);
    expect(plugin.source.ref).toBe(`${manifest.name}--v${manifest.version}`);
  });

  it("declares a Codex plugin manifest and local marketplace entry", () => {
    const manifestPath = path.join(root, ".codex-plugin", "plugin.json");
    const manifest = CodexPluginManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, "utf8")),
    );
    const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
    const marketplace = CodexMarketplaceSchema.parse(
      JSON.parse(readFileSync(marketplacePath, "utf8")),
    );

    expect(marketplace.plugins[0]!.name).toBe(manifest.name);
    expect(existsSync(path.join(root, manifest.skills))).toBe(true);
    expect(manifest.mcpServers["spec-to-pr"].args).toContain("./dist/mcp/server.js");
    expect(existsSync(path.join(root, "dist", "mcp", "server.js"))).toBe(true);
  });

  it("points the MCP server at the production bundle", () => {
    const mcpConfigPath = path.join(root, ".mcp.json");
    const mcpConfig = McpConfigSchema.parse(JSON.parse(readFileSync(mcpConfigPath, "utf8")));

    const server = mcpConfig.mcpServers["spec-to-pr"];

    expect(server.command).toBe("node");
    expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]);

    expect(existsSync(path.join(root, "dist", "mcp", "server.js"))).toBe(true);
  });

  it("contains the doctor skill", () => {
    expect(existsSync(path.join(root, "skills", "doctor", "SKILL.md"))).toBe(true);
  });

  it("contains the visual repair loop skill and Codex custom agents", () => {
    expect(existsSync(path.join(root, "skills", "run-visual-repair-loop", "SKILL.md"))).toBe(true);
    expect(
      existsSync(path.join(root, ".codex", "agents", "spec-to-pr-visual-regression-reviewer.toml")),
    ).toBe(true);
    expect(existsSync(path.join(root, ".codex", "agents", "spec-to-pr-review-council.toml"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(root, ".codex", "agents", "spec-to-pr-design-ui-repair.toml")),
    ).toBe(true);
  });

  it("keeps shared skills compatible with Codex ingestion", () => {
    const skillsRoot = path.join(root, "skills");
    const skillNames = readFileSync(path.join(skillsRoot, "doctor", "SKILL.md"), "utf8");

    expect(skillNames).toContain("disable-model-invocation: false");

    for (const skill of [
      "doctor",
      "spec-to-pr",
      "generate-pr-report",
      "publish-review-request",
      "run-visual-repair-loop",
    ]) {
      const skillPath = path.join(skillsRoot, skill, "SKILL.md");
      const contents = readFileSync(skillPath, "utf8");

      expect(contents).not.toContain("disable-model-invocation: true");
      expect(contents).toMatch(/^---\n/);
      expect(contents).toContain("description:");
      expect(contents).toContain("Codex: `mcp__spec_to_pr__<tool>`");
    }
  });

  it("provides an end-to-end skill that publishes a draft review request but never merges", () => {
    const skillPath = path.join(root, "skills", "spec-to-pr", "SKILL.md");
    const contents = readFileSync(skillPath, "utf8");

    expect(contents).toContain("mcp__spec-to-pr__publish_review_request");
    expect(contents).toContain("mcp__spec_to_pr__publish_review_request");
    expect(contents).toContain("confirm: true");
    expect(contents).toContain("draft PR/MR");
    expect(contents).toContain("Do not merge");
    expect(contents).not.toContain("merge the PR");
  });

  it("ships the Codex SDK runner scaffold", () => {
    const packagePath = path.join(root, "packages", "codex-sdk", "package.json");
    const sdkPackage = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies: Record<string, string>;
    };

    expect(sdkPackage.dependencies["@openai/codex-sdk"]).toBe("0.142.4");
    expect(existsSync(path.join(root, "packages", "codex-sdk", "src", "cli.ts"))).toBe(true);
    expect(
      existsSync(path.join(root, "packages", "codex-sdk", "src", "spec-to-pr-runner.ts")),
    ).toBe(true);
  });

  it("ships an MIT license file", () => {
    const licensePath = path.join(root, "LICENSE");
    const license = readFileSync(licensePath, "utf8");

    expect(license).toContain("MIT License");
  });
});
