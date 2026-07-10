import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const packageVersion = (
  JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    version: string;
  }
).version;

const ClaudePluginManifestSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.literal(packageVersion),
  license: z.literal("MIT"),
  skills: z.string().min(1),
  mcpServers: z.string().min(1),
});

const MarketplaceSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.literal(packageVersion),
  plugins: z
    .array(
      z.object({
        name: z.literal("spec-to-pr"),
        version: z.literal(packageVersion),
        license: z.literal("MIT"),
        source: z.object({
          source: z.literal("url"),
          url: z.literal("https://github.com/dhyun2/spec-to-pr.git"),
          ref: z.literal(`spec-to-pr--v${packageVersion}`),
        }),
      }),
    )
    .length(1),
});

const CodexPluginManifestSchema = z.object({
  name: z.literal("spec-to-pr"),
  version: z.literal(packageVersion),
  license: z.literal("MIT"),
  skills: z.literal("./skills/"),
  mcpServers: z.object({
    spec_to_pr: z.object({
      command: z.literal("node"),
      args: z.array(z.string().min(1)).min(1),
      env: z.object({
        SPEC_TO_PR_HOST: z.literal("codex"),
      }),
    }),
  }),
  interface: z.object({
    displayName: z.literal("SpecToPR"),
    category: z.literal("Developer Tools"),
    capabilities: z.array(z.string().min(1)).min(1),
    defaultPrompt: z.array(z.string().min(1)).min(1).max(3),
  }),
});

const CodexMarketplaceSchema = z.object({
  name: z.literal("spec-to-pr"),
  interface: z.object({
    displayName: z.literal("SpecToPR"),
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
    spec_to_pr: z.object({
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
    expect(manifest.mcpServers.spec_to_pr.args).toContain("./dist/mcp/server.js");
    expect(existsSync(path.join(root, "dist", "mcp", "server.js"))).toBe(true);
  });

  it("points the MCP server at the production bundle", () => {
    const mcpConfigPath = path.join(root, ".mcp.json");
    const mcpConfig = McpConfigSchema.parse(JSON.parse(readFileSync(mcpConfigPath, "utf8")));

    const server = mcpConfig.mcpServers.spec_to_pr;

    expect(server.command).toBe("node");
    expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]);

    expect(existsSync(path.join(root, "dist", "mcp", "server.js"))).toBe(true);
  });

  it("ships a production bundle without runtime dependency imports", () => {
    const bundle = readFileSync(path.join(root, "dist", "mcp", "server.js"), "utf8");
    const runtimeDependencies = ["@modelcontextprotocol/sdk", "minimatch", "pngjs", "yaml", "zod"];

    for (const dependency of runtimeDependencies) {
      const escapedDependency = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      expect(bundle).not.toMatch(
        new RegExp(`^import\\s+[^\\n]+\\s+from\\s+["']${escapedDependency}(?:/[^"']*)?["']`, "m"),
      );
      expect(bundle).not.toMatch(
        new RegExp(`\\bimport\\(\\s*["']${escapedDependency}(?:/[^"']*)?["']\\s*\\)`),
      );
      expect(bundle).not.toMatch(new RegExp(`\\brequire\\(\\s*["']${escapedDependency}`));
    }
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
    expect(contents).toContain("requestSynced: true");
    expect(contents).toContain("visualPreviewSynced: true");
    expect(contents).toContain("generate_review_scorecard");
    expect(contents).toContain("minimumScore: 8");
    expect(contents).toContain("@frontend/ui");
    expect(contents).toContain("uncoveredCount > 0");
    expect(contents).toContain("draft PR/MR");
    expect(contents).toContain("Do not merge");
    expect(contents).not.toContain("merge the PR");
  });

  it("keeps the main workflow aligned across Claude and Codex host surfaces", () => {
    const skillPath = path.join(root, "skills", "spec-to-pr", "SKILL.md");
    const contents = readFileSync(skillPath, "utf8");

    for (const toolName of ["analyze_architecture_boundaries", "generate_source_guard_tests"]) {
      expect(contents).toContain(`mcp__spec-to-pr__${toolName}`);
      expect(contents).toContain(`mcp__spec_to_pr__${toolName}`);
    }

    expect(contents).toContain("Run the architecture gate after integration");
  });

  it("ships Codex counterparts for Claude agents with contract-critical instructions", () => {
    const claudeAgents = readdirSync(path.join(root, "agents"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""));

    for (const agent of claudeAgents) {
      expect(existsSync(path.join(root, ".codex", "agents", `spec-to-pr-${agent}.toml`))).toBe(
        true,
      );
    }

    const codexAgentInvariants = {
      "api-contract": [
        "documented API evidence",
        "Do not invent endpoints",
        "structured AgentResult",
      ],
      "design-ui": [
        "Modify only allowed files",
        "Do not call raw fetch",
        "CheckResult evidence",
        "structured AgentResult",
      ],
      "review-council": [
        "Do not approve missing evidence",
        "skipped checks described as passed",
        "structured findings",
      ],
    } as const;

    for (const [agent, requiredInstructions] of Object.entries(codexAgentInvariants)) {
      const contents = readFileSync(
        path.join(root, ".codex", "agents", `spec-to-pr-${agent}.toml`),
        "utf8",
      );

      for (const instruction of requiredInstructions) {
        expect(contents).toContain(instruction);
      }
    }
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

  it("keeps the MDX installation page free of raw container directives", () => {
    const installation = readFileSync(
      path.join(root, "website", "docs", "getting-started", "installation.mdx"),
      "utf8",
    );

    expect(installation).not.toContain(":::info");
    expect(installation).toContain("제품 표시명은 **SpecToPR**입니다.");
  });

  it("uses SpecToPR as the only public navbar brand", () => {
    const docusaurusConfig = readFileSync(
      path.join(root, "website", "docusaurus.config.ts"),
      "utf8",
    );

    expect(docusaurusConfig).toContain('navbar: {\n      title: "SpecToPR"');
    expect(docusaurusConfig).not.toContain('src: "img/logo.svg"');
  });

  it("ships an MIT license file", () => {
    const licensePath = path.join(root, "LICENSE");
    const license = readFileSync(licensePath, "utf8");

    expect(license).toContain("MIT License");
  });
});
