import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { verifyReviewerProfileParity } from "../../src/release/release-verifier.js";

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

  it("keeps runtime dependencies limited to the production bundle", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "@modelcontextprotocol/sdk",
      "pngjs",
      "zod",
    ]);
    expect(packageJson.devDependencies).toHaveProperty("yaml");
  });

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

  it("describes compact workflow status without removed artifact handles", () => {
    const serverSource = readFileSync(path.join(root, "src", "mcp", "create-server.ts"), "utf8");

    expect(serverSource).toContain("submission-evidence status");
    expect(serverSource).not.toContain("artifact-handle status");
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

  it("ships exactly the nine v2 skills and two canonical reviewer roles", () => {
    const expectedSkills = [
      "archive-openspec",
      "doctor",
      "implement",
      "intake-contracts",
      "prepare-release",
      "publish",
      "review-design",
      "review-functional",
      "spec-to-pr",
    ];
    const expectedClaudeAgents = ["design-reviewer.md", "functional-reviewer.md"];
    const expectedCodexAgents = [
      "spec-to-pr-design-reviewer.toml",
      "spec-to-pr-functional-reviewer.toml",
    ];

    expect(
      readdirSync(path.join(root, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(expectedSkills);
    expect(readdirSync(path.join(root, "agents")).sort()).toEqual(expectedClaudeAgents);
    expect(readdirSync(path.join(root, ".codex", "agents")).sort()).toEqual(expectedCodexAgents);

    for (const skill of expectedSkills) {
      const skillPath = path.join(root, "skills", skill, "SKILL.md");
      const contents = readFileSync(skillPath, "utf8");
      const frontmatter = contents.match(/^---\n([\s\S]*?)\n---/);

      expect(existsSync(skillPath)).toBe(true);
      expect(frontmatter?.[1]?.split("\n").map((line) => line.split(":", 1)[0])).toEqual([
        "name",
        "description",
      ]);
      expect(frontmatter?.[1]).toContain(`name: ${skill}`);
      expect(frontmatter?.[1]).toMatch(/description: Use when /);
    }

    const implement = readFileSync(path.join(root, "skills", "implement", "SKILL.md"), "utf8");
    expect(implement).toContain("one implementation context");
    expect(implement).toContain("api-ready");
    expect(implement.indexOf("api-ready")).toBeLessThan(
      implement.indexOf("UI evidence submission"),
    );

    const main = readFileSync(path.join(root, "skills", "spec-to-pr", "SKILL.md"), "utf8");
    for (const mode of ["brief", "legacy", "feature", "figma"]) {
      expect(main).toContain(`\`${mode}\``);
    }
    for (const field of [
      "projectRoot",
      "requestText",
      "scope",
      "mode",
      "changeKind",
      "publication",
      "briefPath",
      "figmaUrl",
      "docsPaths",
      "openApiPaths",
      "guidancePaths",
      "skillHints",
    ]) {
      expect(main).toContain(`\`${field}\``);
    }
    expect(main).toContain("Delivery mode controls delivery and evidence");
    expect(main).toContain("sources compose independently");
    expect(main).toContain("Any supplied `figmaUrl`");
    expect(main).toContain("Figma defaults to `publication: none`");
    expect(implement).toContain("targeted-feature");
    expect(implement).toContain("exactly one");
    expect(implement).toContain("full-project E2E");
    expect(implement).toContain("kind: api-ready");
    for (const group of ["types", "schemas", "wrappers", "mocks", "contractTests"]) {
      expect(implement).toContain(`\`${group}\``);
    }

    const intake = readFileSync(path.join(root, "skills", "intake-contracts", "SKILL.md"), "utf8");
    expect(intake).toContain("connected Figma");
    expect(intake).toContain("figma-bundle");
    for (const field of ["fileUrl", "nodeIds", "manifestPath", "visualPaths", "artifactPaths"]) {
      expect(intake).toContain(`\`${field}\``);
    }
    expect(intake).toContain("provider: host-connected-figma");
    expect(intake).toContain("`capturedAt`");
    expect(intake).toContain("requirementManifest");
    expect(intake).toContain("legacyBaseline");
    expect(intake).toContain("guidanceTrace");
    expect(intake).toContain("current user request");
    expect(intake).toContain("explicit `guidancePaths`");
    expect(intake).toContain("automatically discovered project guidance");
    expect(intake).toContain("applicable installed skills");
    expect(intake).toContain("SpecToPR defaults");
    expect(intake).toContain("Exclude project guidance from scope classification");
    expect(intake).toContain("Missing optional skills do not block");
    const intakeBody = intake.slice(intake.indexOf("# Intake"));
    expect(intakeBody.indexOf("figma-bundle")).toBeLessThan(
      intakeBody.indexOf("Submit `contracts`"),
    );

    const functionalAgent = readFileSync(
      path.join(root, "agents", "functional-reviewer.md"),
      "utf8",
    );
    const designAgent = readFileSync(path.join(root, "agents", "design-reviewer.md"), "utf8");
    expect(functionalAgent).toContain("targeted-feature");
    expect(functionalAgent).toContain("full-project E2E");
    expect(functionalAgent).toContain("immutable review packet");
    expect(functionalAgent).toContain("reviewPacketId");
    expect(functionalAgent).toContain("Do not call workflow tools");
    for (const requirement of [
      "one unchained Playwright invocation",
      "exactly equal to `testSelector`",
      "non-zero-duration WebM or MP4 container",
      "implementationContextId",
      "testCount",
    ]) {
      expect(functionalAgent).toContain(requirement);
    }
    expect(designAgent).toContain("does not replace a visual baseline");
    expect(designAgent).toContain("immutable review packet");
    expect(designAgent).toContain("reviewPacketId");
    for (const reviewer of [functionalAgent, designAgent]) {
      expect(reviewer).toContain("guidanceTrace");
      expect(reviewer).toContain("applied optional skills");
    }
    expect(functionalAgent).toContain("API and framework conventions");
    expect(designAgent).toContain("design-system and UI conventions");

    const functionalReviewSkill = readFileSync(
      path.join(root, "skills", "review-functional", "SKILL.md"),
      "utf8",
    );
    for (const requirement of [
      "one unchained Playwright invocation",
      "exactly equal to `testSelector`",
      "non-zero-duration WebM or MP4 container",
      "implementationContextId",
      "testCount",
    ]) {
      expect(functionalReviewSkill).toContain(requirement);
    }
    expect(functionalReviewSkill).toContain("reviewPacketId");

    const codexFunctionalAgent = readFileSync(
      path.join(root, ".codex", "agents", "spec-to-pr-functional-reviewer.toml"),
      "utf8",
    );
    for (const requirement of [
      "implementationContextId",
      "testCount",
      "non-zero-duration",
      "25 MB",
    ]) {
      expect(codexFunctionalAgent).toContain(requirement);
    }
    expect(codexFunctionalAgent).toContain("reviewPacketId");
    expect(codexFunctionalAgent).toContain("Scope splits");
    expect(codexFunctionalAgent).toContain("guidanceTrace");
    expect(codexFunctionalAgent).toContain("applied optional skills");
    expect(codexFunctionalAgent).toContain("API and framework conventions");

    const codexDesignAgent = readFileSync(
      path.join(root, ".codex", "agents", "spec-to-pr-design-reviewer.toml"),
      "utf8",
    );
    expect(codexDesignAgent).toContain("reviewPacketId");
    expect(codexDesignAgent).toContain("Scope splits");
    expect(codexDesignAgent).toContain("guidanceTrace");
    expect(codexDesignAgent).toContain("applied optional skills");
    expect(codexDesignAgent).toContain("design-system and UI conventions");

    const workflowService = readFileSync(
      path.join(root, "src", "application", "workflow-service.ts"),
      "utf8",
    );
    expect(workflowService).toContain('"## Project guidance"');
    expect(workflowService).toContain('"### Explicit"');
    expect(workflowService).toContain('"### Automatically discovered"');
    expect(workflowService).toContain('"## Applied optional skills"');
    expect(workflowService).toContain("contracts.guidanceTrace.explicit");
    expect(workflowService).toContain("contracts.guidanceTrace.discovered");
    expect(workflowService).toContain("contracts.guidanceTrace.skillHints");

    const publish = readFileSync(path.join(root, "skills", "publish", "SKILL.md"), "utf8");
    for (const field of [
      "runId",
      "mode",
      "sourceBranch",
      "targetBranch",
      "pushBranch",
      "confirm",
    ]) {
      expect(publish).toContain(`\`${field}\``);
    }
    expect(publish).toContain("source branch");
    expect(publish).toContain("working tree is clean");
    expect(publish).toContain("at least one commit ahead");
  });

  it("keeps v2 definitions host-neutral and limited to the seven workflow tools", () => {
    const allowedTools = new Set([
      "workflow_advance",
      "workflow_archive",
      "workflow_info",
      "workflow_publish",
      "workflow_start",
      "workflow_status",
      "workflow_submit",
    ]);
    const legacyTools = [
      "capture_browser_screenshots",
      "compare_visual_snapshots",
      "create_run",
      "generate_pr_report",
      "kernel_info",
      "publish_review_request",
      "run_quality_gates",
    ];
    const definitionPaths = [
      ...readdirSync(path.join(root, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, "skills", entry.name, "SKILL.md")),
      ...readdirSync(path.join(root, "agents")).map((file) => path.join(root, "agents", file)),
      ...readdirSync(path.join(root, ".codex", "agents")).map((file) =>
        path.join(root, ".codex", "agents", file),
      ),
    ];

    for (const definitionPath of definitionPaths) {
      const contents = readFileSync(definitionPath, "utf8");
      const referencedTools = contents.match(/\bworkflow_[a-z_]+\b/g) ?? [];

      expect(contents).not.toMatch(/mcp__spec(?:-to-pr|_to_pr)__/);
      expect(contents).not.toContain("## MCP Tool Namespace");
      expect(referencedTools.every((tool) => allowedTools.has(tool))).toBe(true);
      for (const legacyTool of legacyTools) {
        expect(contents).not.toContain(legacyTool);
      }
    }

    const mainSkill = readFileSync(path.join(root, "skills", "spec-to-pr", "SKILL.md"), "utf8");
    expect(new Set(mainSkill.match(/\bworkflow_[a-z_]+\b/g) ?? [])).toEqual(allowedTools);
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

  it("ships Codex SDK dist built for only the v2 workflow facade", () => {
    const rootPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const distDirectory = path.join(root, "packages", "codex-sdk", "dist");
    const shippedFiles = ["workflow-policy.js", "spec-to-pr-runner.js", "cli.js"];
    const shipped = shippedFiles
      .map((file) => readFileSync(path.join(distDirectory, file), "utf8"))
      .join("\n");
    const expectedTools = [
      "workflow_info",
      "workflow_start",
      "workflow_advance",
      "workflow_submit",
      "workflow_status",
      "workflow_publish",
      "workflow_archive",
    ];
    const removedV1Names = [
      "capture_browser_screenshots",
      "compare_visual_snapshots",
      "evaluate_visual_repair_loop",
      "generate_pr_report",
      "plan_visual_regression",
      "publish_review_request",
      "run_quality_gates",
    ];

    for (const tool of expectedTools) {
      expect(shipped).toContain(tool);
    }
    for (const removedName of removedV1Names) {
      expect(shipped).not.toContain(removedName);
    }
    expect(shipped).toContain("functional-reviewer");
    expect(shipped).toContain("design-reviewer");
    expect(shipped).not.toContain("visual-regression-reviewer");
    expect(rootPackage.scripts["sdk:check-dist"]).toBe(
      "node scripts/check-generated-files.mjs packages/codex-sdk/dist",
    );
    expect(rootPackage.scripts["schemas:check"]).toBe(
      "node scripts/check-generated-files.mjs schemas/runtime",
    );
    expect(rootPackage.scripts["bundle:check-dist"]).toBe(
      "node scripts/check-generated-files.mjs dist/mcp/server.js",
    );
    expect(rootPackage.scripts["check"]).toContain("pnpm sdk:build && pnpm sdk:check-dist");
    expect(rootPackage.scripts["check"]).toContain("pnpm schemas:build && pnpm schemas:check");
    expect(rootPackage.scripts["check"]).toContain("pnpm build && pnpm bundle:check-dist");

    const sdkPackage = JSON.parse(
      readFileSync(path.join(root, "packages", "codex-sdk", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(sdkPackage.scripts["build"]).toBe("node ../../scripts/build-codex-sdk.mjs");
    expect(existsSync(path.join(root, "scripts", "build-codex-sdk.mjs"))).toBe(true);
    expect(existsSync(path.join(root, "scripts", "check-generated-files.mjs"))).toBe(true);

    const schemaBuilder = readFileSync(
      path.join(root, "scripts", "export-runtime-schemas.ts"),
      "utf8",
    );
    expect(schemaBuilder).toContain("await rm(outputDirectory");
  });

  it("keeps the MDX installation page free of raw container directives", () => {
    const installation = readFileSync(
      path.join(root, "website", "docs", "getting-started", "installation.mdx"),
      "utf8",
    );

    expect(installation).not.toContain(":::info");
    expect(installation).toContain("제품명은 **SpecToPR**");
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

  it("keeps the shipped Markdown and Codex reviewer safety markers in parity", () => {
    const reviewerFiles = new Map<string, Buffer>(
      [
        "agents/design-reviewer.md",
        "agents/functional-reviewer.md",
        ".codex/agents/spec-to-pr-design-reviewer.toml",
        ".codex/agents/spec-to-pr-functional-reviewer.toml",
      ].map((file) => [file, readFileSync(path.join(root, file))]),
    );

    expect(verifyReviewerProfileParity(reviewerFiles)).toEqual([]);
  });
});
