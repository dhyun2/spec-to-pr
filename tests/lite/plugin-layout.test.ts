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
    expect(skill).toContain("사내 디자인 시스템");
    expect(skill).toContain("`brief`와 `feature`");
    expect(skill).toContain("test: on");
    expect(skill).toContain("TDD");
  });

  it("ships the fixed Korean PR sections and bundled comparator", () => {
    const template = readFileSync(
      path.join(root, "skills/spec-to-pr/assets/pr-template.md"),
      "utf8",
    );

    for (const section of ["개발한 기능", "화면 일치율", "사용한 API", "Gap", "검증"]) {
      expect(template).toContain(`## ${section}`);
    }
    expect(existsSync(path.join(root, "skills/spec-to-pr/scripts/compare-images.cjs"))).toBe(true);
    expect(existsSync(path.join(root, "skills/spec-to-pr/scripts/check-gitlab-mr.cjs"))).toBe(true);
  });
});

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8")) as Record<string, unknown>;
}
