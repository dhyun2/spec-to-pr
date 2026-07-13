import { describe, expect, it } from "vitest";

import { buildSpecToPrPrompt } from "../../packages/codex-sdk/src/spec-to-pr-runner.js";
import {
  buildCodexReviewAgentInstructions,
  CODEX_REVIEW_AGENT_PROFILES,
  CODEX_WORKFLOW_TOOL_NAMES,
} from "../../packages/codex-sdk/src/workflow-policy.js";

const legacyToolNames = [
  "generate_pr_report",
  "publish_review_request",
  "plan_visual_regression",
  "capture_browser_screenshots",
  "compare_visual_snapshots",
  "evaluate_visual_repair_loop",
];

describe("Codex SDK workflow policy", () => {
  it("uses only the seven workflow facade tools", () => {
    expect(CODEX_WORKFLOW_TOOL_NAMES).toEqual([
      "workflow_info",
      "workflow_start",
      "workflow_advance",
      "workflow_submit",
      "workflow_status",
      "workflow_publish",
      "workflow_archive",
    ]);

    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the API endpoint from the brief.",
      openApiPath: "docs/openapi.yaml",
    });

    for (const toolName of CODEX_WORKFLOW_TOOL_NAMES) {
      expect(prompt).toContain(toolName);
    }
    for (const toolName of legacyToolNames) {
      expect(prompt).not.toContain(toolName);
    }
  });

  it("requests only functional review for non-UI code scope", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement a database migration and API endpoint.",
    });

    expect(CODEX_REVIEW_AGENT_PROFILES.map((profile) => profile.name)).toEqual([
      "functional-reviewer",
      "design-reviewer",
    ]);
    expect(prompt).toContain("functional-reviewer");
    expect(prompt).not.toContain("design-reviewer");
  });

  it("adds design review for applicable UI scope", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the responsive account settings screen.",
      figmaUrl: "https://figma.com/design/example",
    });

    expect(prompt).toContain("functional-reviewer");
    expect(prompt).toContain("design-reviewer");
    expect(buildCodexReviewAgentInstructions({ includeDesignReview: true })).toContain(
      "design-reviewer",
    );
  });

  it("keeps API and UI work in one context and requires mocks before UI completion", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the API-backed dashboard.",
      figmaUrl: "https://figma.com/design/example",
      openApiPath: "docs/openapi.yaml",
    });

    expect(prompt).toContain("one implementation context");
    expect(prompt).toContain("api-ready");
    expect(prompt).toContain("mocks");
    expect(prompt.indexOf("mocks")).toBeLessThan(prompt.indexOf("UI completion"));
  });
});
