import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("v2 documentation", () => {
  it("keeps only the current ADRs and compact website pages", () => {
    expect(readdirSync(path.join(root, "docs", "adr")).sort()).toEqual([
      "035-use-coarse-workflow-facade-and-split-reviews.md",
      "036-use-delivery-profiles-not-mode-specific-pipelines.md",
      "037-use-boundary-budgeting-and-numeric-calibration.md",
    ]);
    expect(relativeFiles(path.join(root, "website", "docs"))).toEqual([
      "concepts/pipeline.md",
      "getting-started/installation.mdx",
      "getting-started/prerequisites.md",
      "getting-started/quickstart.md",
      "intro.md",
      "reference/config.md",
      "reference/skills.md",
      "troubleshooting.md",
      "usage/recipes.md",
    ]);
  });

  it("documents the four profiles and exact lightweight surface without v1 calls", () => {
    const paths = [
      "README.md",
      "README.ko.md",
      "packages/codex-sdk/README.md",
      ...relativeFiles(path.join(root, "docs", "adr")).map((file) => `docs/adr/${file}`),
      ...relativeFiles(path.join(root, "website", "docs")).map((file) => `website/docs/${file}`),
    ];
    const contents = paths.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");

    for (const mode of ["brief", "legacy", "feature", "figma"]) {
      expect(contents).toContain(`\`${mode}\``);
    }
    for (const fact of ["7 MCP tools", "8 durable stages", "9 skills", "2 independent reviewers"]) {
      expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain(fact);
    }
    for (const obsolete of [
      "kernel_info",
      "create_run",
      "generate_pr_report",
      "publish_review_request",
      "/spec-to-pr:figma-doctor",
      "/spec-to-pr:run-visual-regression",
      "--no-visual-repair-loop",
      "--min-visual-score",
      "--max-repair-attempts",
    ]) {
      expect(contents).not.toContain(obsolete);
    }

    expect(contents).toContain("full-project E2E");
    expect(contents).toContain("exactly one");
    expect(contents).toContain("figma-bundle");
    expect(contents).toContain("apiArtifacts");
    expect(contents).toContain("implementationContextId");
    expect(contents).toContain("host-connected-figma");
    expect(contents).toContain("immutable");
    expect(contents).toContain("draft-only");
    expect(contents).toContain("clean tree");
    expect(contents).toContain("workloadSignals");
    expect(contents).toContain("split-required");
    expect(contents).not.toContain("approval-required");
    expect(contents).not.toContain("--token-budget");
    expect(contents).not.toContain("tokenBudget");
    expect(contents).toContain("80%");
    expect(contents).toContain("numeric-only");
    expect(contents).toContain("usage-unavailable");
    expect(contents).toContain("requiredValidations");
    expect(contents).toContain("resumeContext");
    expect(contents).toContain("outputFormatting");
  });

  it("keeps every retained Figma checklist aligned with the typed provenance contract", () => {
    const checklistPaths = [
      "docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md",
      "website/docs/getting-started/prerequisites.md",
      "website/docs/troubleshooting.md",
    ];

    for (const file of checklistPaths) {
      const contents = readFileSync(path.join(root, file), "utf8");
      expect(contents, file).toContain("provider: host-connected-figma");
      expect(contents, file).toContain("capturedAt");
      expect(contents, file).toContain("fileUrl");
      expect(contents, file).toContain("nodeIds");
      expect(contents, file).toContain("manifestPath");
      expect(contents, file).toContain("visualPaths");
      expect(contents, file).toContain("PNG");
      expect(contents, file).not.toMatch(/JPEG|SVG/);
    }
  });

  it("documents composable sources, guidance precedence, and the zero-to-100 feature recipe", () => {
    const readmes = ["README.md", "README.ko.md", "packages/codex-sdk/README.md"].map((file) =>
      readFileSync(path.join(root, file), "utf8"),
    );
    const recipe = readFileSync(path.join(root, "website/docs/usage/recipes.md"), "utf8");
    const config = readFileSync(path.join(root, "website/docs/reference/config.md"), "utf8");
    const skills = readFileSync(path.join(root, "website/docs/reference/skills.md"), "utf8");
    const pipeline = readFileSync(path.join(root, "website/docs/concepts/pipeline.md"), "utf8");
    const troubleshooting = readFileSync(
      path.join(root, "website/docs/troubleshooting.md"),
      "utf8",
    );

    for (const contents of readmes) {
      for (const field of [
        "briefPath",
        "figmaUrl",
        "docsPaths",
        "openApiPaths",
        "guidancePaths",
        "skillHints",
      ]) {
        expect(contents).toContain(field);
      }
      expect(contents).toContain("mode: feature");
    }

    for (const field of [
      "mode: feature",
      "briefPath: docs/checkout.md",
      "figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345",
      "openApiPaths:",
      "docsPaths:",
      "guidancePaths:",
      "skillHints:",
    ]) {
      expect(recipe).toContain(field);
    }
    expect(recipe).toContain("api-generator");
    expect(recipe).toContain("design-system");
    expect(recipe).toContain("react-best-practices");
    expect(recipe).toContain("next-best-practices");
    const apiBackedUiRecipe = recipe.slice(
      recipe.indexOf("## 5. API가 있는 UI"),
      recipe.indexOf("## 6. 발행하지 않기"),
    );
    expect(apiBackedUiRecipe).toContain("openApiPaths: [docs/openapi.yaml]");
    expect(apiBackedUiRecipe).not.toContain("OpenAPI: docs/openapi.yaml");

    for (const field of [
      "docsPaths",
      "openApiPaths",
      "guidancePaths",
      "discoveredGuidancePaths",
      "skillHints",
    ]) {
      expect(config).toContain(field);
    }
    for (const candidate of [
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "docs/architecture/ARCHITECTURE.md",
      "docs/etc/folder-structure.md",
    ]) {
      expect(config).toContain(candidate);
    }
    expect(config).toContain("current user request");
    expect(config).toContain("explicit `guidancePaths`");
    expect(config).toContain("automatically discovered project guidance");
    expect(config).toContain("applicable installed skills");
    expect(config).toContain("SpecToPR defaults");

    expect(skills).toContain("available and applicable");
    expect(skills).toContain("Missing optional skills");
    expect(pipeline).toContain("Delivery mode controls delivery and evidence");
    expect(pipeline).toContain("excluded from scope classification");
    expect(troubleshooting).toContain("Missing optional skills do not block");
    expect(troubleshooting).toContain("feature mode");
    expect(troubleshooting).toContain("figma-bundle");
  });
});

function relativeFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory()
        ? relativeFiles(path.join(directory, entry.name), relative)
        : [relative];
    })
    .sort();
}
