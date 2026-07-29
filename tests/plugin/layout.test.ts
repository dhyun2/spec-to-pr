import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { MCP_ENTRY_MAX_BYTES, MCP_TOTAL_JS_MAX_BYTES } from "../../src/release/release-manifest.js";
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

  it("keeps transient agent plans out of the repository", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");

    expect(existsSync(path.join(root, "docs", "superpowers"))).toBe(false);
    expect(gitignore.split(/\r?\n/)).toContain("docs/superpowers/");
  });

  it("ships the strict draft evidence manifest contract and documents every allowed field", () => {
    const index = JSON.parse(
      readFileSync(path.join(root, "schemas", "runtime", "index.json"), "utf8"),
    ) as { dialect: string; files: string[] };
    const manifest = JSON.parse(
      readFileSync(
        path.join(root, "schemas", "runtime", "draft-evidence-manifest.schema.json"),
        "utf8",
      ),
    ) as {
      $schema: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    const intakeSkill = readFileSync(
      path.join(root, "skills", "intake-contracts", "SKILL.md"),
      "utf8",
    );

    expect(index.dialect).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(index.files).toContain("draft-evidence-manifest.schema.json");
    expect(manifest.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(manifest.additionalProperties).toBe(false);
    expect(manifest.required).toEqual([
      "schemaVersion",
      "runId",
      "runRevision",
      "phase",
      "legacyRootDigest",
      "requirementIds",
      "openSpec",
    ]);
    expect(Object.keys(manifest.properties)).toEqual(manifest.required);
    for (const field of manifest.required) {
      expect(intakeSkill).toContain(`"${field}"`);
    }
    expect(intakeSkill).toContain('"digest": "sha256:<64 lowercase hex characters>"');
    expect(intakeSkill).toContain("exact file bytes");
    expect(intakeSkill).toContain("accepts no additional fields");
    expect(intakeSkill).not.toMatch(/["`]\s*head(?:Sha)?\s*["`]/iu);
  });

  it("keeps runtime dependencies limited to the production bundle", () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "@babel/parser",
      "@modelcontextprotocol/sdk",
      "pdfjs-dist",
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
    const bundleDirectory = path.join(root, "dist", "mcp");
    const bundleFiles = readdirSync(bundleDirectory)
      .filter((file) => file.endsWith(".js"))
      .sort();
    const bundles = bundleFiles.map((file) => ({
      file,
      content: readFileSync(path.join(bundleDirectory, file), "utf8"),
    }));
    const runtimeDependencies = ["@modelcontextprotocol/sdk", "minimatch", "pngjs", "yaml", "zod"];

    expect(bundleFiles).toContain("server.js");
    expect(bundleFiles.length).toBeGreaterThan(1);
    expect(readFileSync(path.join(bundleDirectory, "server.js")).byteLength).toBeLessThanOrEqual(
      MCP_ENTRY_MAX_BYTES,
    );
    expect(
      bundles.reduce((total, bundle) => total + Buffer.byteLength(bundle.content), 0),
    ).toBeLessThanOrEqual(MCP_TOTAL_JS_MAX_BYTES);

    for (const { content } of bundles) {
      for (const dependency of runtimeDependencies) {
        const escapedDependency = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        expect(content).not.toMatch(
          new RegExp(`^import\\s+[^\\n]+\\s+from\\s+["']${escapedDependency}(?:/[^"']*)?["']`, "m"),
        );
        expect(content).not.toMatch(
          new RegExp(`\\bimport\\(\\s*["']${escapedDependency}(?:/[^"']*)?["']\\s*\\)`),
        );
        expect(content).not.toMatch(new RegExp(`\\brequire\\(\\s*["']${escapedDependency}`));
      }
    }
  });

  it("ships exactly eight public v2 skills, one maintainer skill, and two read-only reviewers", () => {
    const expectedSkills = [
      "archive-openspec",
      "doctor",
      "implement",
      "intake-contracts",
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
    expect(existsSync(path.join(root, "skills", "prepare-release"))).toBe(false);
    expect(existsSync(path.join(root, ".agents", "skills", "prepare-release", "SKILL.md"))).toBe(
      true,
    );

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
      "openApiUrls",
      "legacyProjectRoot",
      "legacyNetworkEvidencePath",
      "guidancePaths",
      "skillHints",
    ]) {
      expect(main).toContain(`\`${field}\``);
    }
    expect(main).toContain("Delivery mode controls delivery and evidence");
    expect(main).toContain("sources compose independently");
    expect(main).toContain("Any supplied `figmaUrl`");
    expect(main).toContain("`auto | ui | non-ui | docs`");
    expect(main).toContain("The four delivery cases are UI contracts");
    expect(main).toContain("Figma defaults to `publication: draft`");
    expect(main).toContain("immutable feature boundary");
    expect(main).toContain("not a dependency visibility boundary");
    expect(main).toContain("directly referenced dependency evidence");
    expect(main).not.toContain("complete source boundary");
    expect(main).toContain("report an in-bound scope mismatch");
    for (const contract of [
      "sourceProvenance",
      "visualTargets",
      "compare-visuals",
      "legacyInventory",
      "apiCoverage",
      "performanceEvidence",
      "pr-report-v2",
    ]) {
      expect(main).toContain(contract);
    }
    expect(implement).toContain("targeted-feature");
    expect(implement).toContain("exactly one");
    expect(implement).toContain("full-project E2E");
    expect(implement).toContain("kind: api-ready");
    expect(implement).toContain("operations");
    expect(implement).toContain("apiCoverage");
    expect(implement).toContain("performanceEvidence");
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
    expect(intake).toContain("legacyInventory");
    expect(intake).toContain("legacyCoverage");
    expect(intake).toContain("visualTargets");
    expect(intake).toContain("sourceProvenance");
    expect(intake).toContain("guidanceTrace");
    expect(intake).toContain("current user request");
    expect(intake).toContain("explicit `guidancePaths`");
    expect(intake).toContain("automatically discovered project guidance");
    expect(intake).toContain("applicable installed skills");
    expect(intake).toContain("SpecToPR defaults");
    expect(intake).toContain("immutable feature boundary");
    expect(intake).toContain("not a dependency visibility boundary");
    expect(intake).toContain("directly referenced dependency evidence");
    expect(intake).not.toContain("complete source boundary");
    expect(intake).toContain("report an in-bound scope mismatch");
    expect(intake).toContain("Exclude project guidance from scope classification");
    expect(intake).toContain("Missing optional skills do not block");
    expect(intake).toContain("`auto | ui | non-ui | docs`");
    expect(intake).toContain(
      "Require `scope: ui` for all four explicit delivery modes: `brief`, `legacy`, `feature`, and `figma`",
    );
    const intakeBody = intake.slice(intake.indexOf("# Intake"));
    expect(intakeBody.indexOf("figma-bundle")).toBeLessThan(
      intakeBody.indexOf("Submit `contracts`"),
    );

    const functionalAgent = readFileSync(
      path.join(root, "agents", "functional-reviewer.md"),
      "utf8",
    );
    const designAgent = readFileSync(path.join(root, "agents", "design-reviewer.md"), "utf8");
    for (const reviewer of [functionalAgent, designAgent]) {
      expect(reviewer).toContain("tools: Read, Glob, Grep");
      expect(reviewer).toContain("Read-only reviewer");
      expect(reviewer).toContain("Never edit implementation");
      expect(reviewer).toContain("workflow MCP");
    }
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
    expect(codexFunctionalAgent).toContain('sandbox_mode = "read-only"');
    expect(parseEmptyTomlTable(codexFunctionalAgent, "mcp_servers")).toEqual({});
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
    expect(codexDesignAgent).toContain('sandbox_mode = "read-only"');
    expect(parseEmptyTomlTable(codexDesignAgent, "mcp_servers")).toEqual({});
    expect(codexDesignAgent).toContain("reviewPacketId");
    expect(codexDesignAgent).toContain("Scope splits");
    expect(codexDesignAgent).toContain("guidanceTrace");
    expect(codexDesignAgent).toContain("applied optional skills");
    expect(codexDesignAgent).toContain("design-system and UI conventions");

    const reportRenderer = readFileSync(
      path.join(root, "src", "pr-report", "workflow-report-renderer.ts"),
      "utf8",
    );
    expect(reportRenderer).toContain('"## Project guidance"');
    expect(reportRenderer).toContain('"### Explicit"');
    expect(reportRenderer).toContain('"### Automatically discovered"');
    expect(reportRenderer).toContain('"## Applied optional skills"');
    expect(reportRenderer).toContain("input.guidanceTrace.explicit");
    expect(reportRenderer).toContain("input.guidanceTrace.discovered");
    expect(reportRenderer).toContain("input.guidanceTrace.skillHints");

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

    const descriptions = Object.fromEntries(
      expectedSkills.map((skill) => {
        const contents = readFileSync(path.join(root, "skills", skill, "SKILL.md"), "utf8");
        const description = /^description: (.+)$/mu.exec(contents)?.[1];
        return [skill, description];
      }),
    );
    expect(descriptions).toEqual({
      "archive-openspec":
        "Use when the user explicitly requests post-merge archival for a merged spec-to-pr change with authoritative merge evidence.",
      doctor:
        "Use when checking whether the spec-to-pr v2 workflow facade is installed, reachable, and exposing the expected contract.",
      implement:
        "Use when the current v2 external action requests same-context implementation from accepted contracts.",
      "intake-contracts":
        "Use when the current v2 external action requests intake or contract preparation from supplied sources and repository context.",
      publish:
        "Use when the user explicitly requests creating or updating a draft review request for a publish-ready or blocked-diagnostic v2 Run.",
      "review-design":
        "Use when applicable UI scope reaches the v2 design-review action for an independent visual, interaction, and accessibility verdict.",
      "review-functional":
        "Use when code scope reaches the mandatory v2 functional-review action for an independent evidence-based verdict.",
      "spec-to-pr":
        "Use when orchestrating an evidence-driven v2 Run across its stage-specific external actions.",
    });

    for (const policySource of [intake, implement, functionalReviewSkill]) {
      expect(policySource).toContain("deliveryProfile.recommendedSkills");
      expect(policySource).toContain("actually applied");
    }
    expect(intake).toContain("`figmaUrl` -> `figma`, `design-system`");
    expect(intake).toContain("`openApiPaths` or `openApiUrls` -> `api-generator`");
    expect(intake).toContain("React package evidence -> `react-best-practices`");
    expect(intake).toContain("Next.js package evidence -> `next-best-practices`");
    expect(intake).toContain("feature UI -> `playwright`");

    const designReviewSkill = readFileSync(
      path.join(root, "skills", "review-design", "SKILL.md"),
      "utf8",
    );
    for (const policySource of [implement, functionalReviewSkill, designReviewSkill]) {
      expect(policySource).toContain("Playwright Test/CLI is the acceptance oracle");
      expect(policySource).toContain("browser MCP is optional interactive diagnosis");
      expect(policySource).toContain(
        "console, network, performance, memory, or live-DOM diagnosis",
      );
      expect(policySource).toContain("screenshots and video do not replace assertions");
      expect(policySource).toContain("BROWSER_NOT_RUN");
    }
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
      "node scripts/check-generated-files.mjs dist/mcp",
    );
    expect(rootPackage.scripts["check"]).toBe("tsx scripts/run-repository-checks.ts");
    const repositoryCheckPlan = readFileSync(
      path.join(root, "src", "release", "repository-check-plan.ts"),
      "utf8",
    );
    expect(repositoryCheckPlan).toContain('id: "sdk"');
    expect(repositoryCheckPlan).toContain('id: "schemas"');
    expect(repositoryCheckPlan).toContain('id: "mcp"');
    expect(repositoryCheckPlan).toContain('["pnpm", ["sdk:build"]]');
    expect(repositoryCheckPlan).toContain('["pnpm", ["schemas:build"]]');
    expect(repositoryCheckPlan).toContain('["pnpm", ["build"]]');

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

  it("keeps plugin-maintainer checks out of a target-project implementation run", () => {
    const implementationSkill = readFileSync(
      path.join(root, "skills", "implement", "SKILL.md"),
      "utf8",
    );

    expect(implementationSkill).toContain("plugin-maintainer checks");
    expect(implementationSkill).toContain("pnpm check");
    expect(implementationSkill).toContain("case4:check");
    expect(implementationSkill).toContain("bench:runtime");
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

  it("ships the strict visual evidence contract in every reviewer profile", () => {
    for (const file of [
      "agents/design-reviewer.md",
      "agents/functional-reviewer.md",
      ".codex/agents/spec-to-pr-design-reviewer.toml",
      ".codex/agents/spec-to-pr-functional-reviewer.toml",
    ]) {
      const contents = readFileSync(path.join(root, file), "utf8").toLowerCase();
      for (const marker of [
        "92%",
        "focused ui assertions",
        "baseline references",
        "renderer lineage",
        "third valid failure",
      ]) {
        expect(contents, `${file}:${marker}`).toContain(marker);
      }
    }
  });
});

function parseEmptyTomlTable(contents: string, key: string): Record<string, never> {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignment = new RegExp(`^${escapedKey}\\s*=\\s*(.+)$`, "mu").exec(contents)?.[1]?.trim();

  if (assignment !== "{}") {
    throw new Error(`${key} must be an explicit empty TOML inline table`);
  }
  return {};
}
