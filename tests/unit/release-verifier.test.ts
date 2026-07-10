import { describe, expect, it } from "vitest";

import { verifyReleasePackageFiles } from "../../src/release/index.js";

describe("release verifier", () => {
  it("passes required plugin files", () => {
    const result = verifyReleasePackageFiles([
      ".agents/plugins/marketplace.json",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/plugin.json",
      ".codex/agents/spec-to-pr-design-ui-repair.toml",
      ".codex/agents/spec-to-pr-review-council.toml",
      ".codex/agents/spec-to-pr-visual-regression-reviewer.toml",
      ".codex-plugin/plugin.json",
      ".mcp.json",
      "CHANGELOG.md",
      "dist/mcp/server.js",
      "package.json",
      "skills/doctor/SKILL.md",
    ]);

    expect(result.status).toBe("passed");
  });

  it("rejects forbidden files", () => {
    const result = verifyReleasePackageFiles([
      ".agents/plugins/marketplace.json",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/plugin.json",
      ".codex/agents/spec-to-pr-design-ui-repair.toml",
      ".codex/agents/spec-to-pr-review-council.toml",
      ".codex/agents/spec-to-pr-visual-regression-reviewer.toml",
      ".codex-plugin/plugin.json",
      ".mcp.json",
      "CHANGELOG.md",
      "dist/mcp/server.js",
      "package.json",
      "node_modules/foo/index.js",
    ]);

    expect(result.status).toBe("failed");
    expect(result.failures.some((failure) => failure.includes("node_modules"))).toBe(true);
  });
});
