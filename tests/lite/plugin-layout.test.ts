import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("SpecToPR Lite package", () => {
  it("ships one skills-only public interface", () => {
    const codex = readJson(".codex-plugin/plugin.json");
    const claude = readJson(".claude-plugin/plugin.json");
    const skills = readdirSync(path.join(root, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(codex).not.toHaveProperty("mcpServers");
    expect(claude).not.toHaveProperty("mcpServers");
    expect(skills).toEqual(["spec-to-pr"]);
    for (const retiredPath of [".mcp.json", "src", "dist", "schemas"]) {
      expect(existsSync(path.join(root, retiredPath))).toBe(false);
    }
  });

  it("documents all four cases without workflow state", () => {
    const skill = readFileSync(path.join(root, "skills/spec-to-pr/SKILL.md"), "utf8");

    for (const caseName of ["brief", "feature", "figma", "legacy"]) {
      expect(skill).toContain(`\`${caseName}\``);
    }
    expect(skill).not.toContain("workflow_");
    expect(skill).not.toContain("Run ID");
    expect(skill).toContain("보존 이관");
    expect(skill).toContain("legacy-visual-evidence.cjs");
    expect(skill).toContain("`brief`와 `feature`");
    expect(skill).toContain("test: on");
    expect(skill).toContain("TDD");
  });

  it("ships four focused PR templates and legacy visual evidence tooling", () => {
    const templates = path.join(root, "skills/spec-to-pr/assets/pr-templates");
    const legacyTemplate = readFileSync(path.join(templates, "legacy-migration.md"), "utf8");
    const briefTemplate = readFileSync(path.join(templates, "brief-delivery.md"), "utf8");
    const featureTemplate = readFileSync(path.join(templates, "feature-flow.md"), "utf8");
    const figmaTemplate = readFileSync(path.join(templates, "figma-ui.md"), "utf8");

    expect(legacyTemplate).toContain("기준 · 이관 결과 · Diff");
    expect(briefTemplate).toContain("요구사항 충족");
    expect(featureTemplate).toContain("사용자 흐름 영상");
    expect(figmaTemplate).toContain("Figma 상태 매핑");
    expect(existsSync(path.join(root, "skills/spec-to-pr/scripts/compare-images.cjs"))).toBe(true);
    expect(
      existsSync(path.join(root, "skills/spec-to-pr/scripts/legacy-visual-evidence.cjs")),
    ).toBe(true);
    expect(
      existsSync(path.join(root, "skills/spec-to-pr/scripts/legacy-source-inventory.cjs")),
    ).toBe(true);
    expect(existsSync(path.join(root, "skills/spec-to-pr/scripts/check-gitlab-mr.cjs"))).toBe(true);
  });
});

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8")) as Record<string, unknown>;
}
