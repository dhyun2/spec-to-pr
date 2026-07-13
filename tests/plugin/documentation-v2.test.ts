import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("v2 documentation", () => {
  it("keeps only the current ADRs and compact website pages", () => {
    expect(readdirSync(path.join(root, "docs", "adr")).sort()).toEqual([
      "035-use-coarse-workflow-facade-and-split-reviews.md",
      "036-use-delivery-profiles-not-mode-specific-pipelines.md",
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
