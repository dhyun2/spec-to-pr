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
    expect(prompt).toContain('kind: "api-ready"');
    expect(prompt).toContain("apiArtifacts");
    expect(prompt).toContain("contractTests");
    expect(prompt).toContain("mocks");
    expect(prompt.indexOf("mocks")).toBeLessThan(prompt.indexOf("UI completion"));
  });

  it("passes explicit brief and legacy delivery profiles to workflow_start", () => {
    const brief = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "brief",
      changeKind: "feature",
      publication: "draft",
      briefPath: "docs/brief.md",
    });
    const legacy = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "legacy",
      changeKind: "fix",
      publication: "draft",
      prompt: "Fix only the affected parser behavior.",
    });

    expect(brief).toContain('mode: "brief"');
    expect(brief).toContain('briefPath: "docs/brief.md"');
    expect(brief).toContain("design-reviewer");
    expect(brief).toContain("workflow_status snapshot");
    expect(legacy).toContain('mode: "legacy"');
    expect(legacy).toContain("focused baseline");
  });

  it("rejects incomplete mode-specific SDK inputs before starting Codex", () => {
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "brief",
      }),
    ).toThrow(/briefPath/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "figma",
      }),
    ).toThrow(/figmaUrl/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "legacy",
      }),
    ).toThrow(/concrete prompt/);
    expect(() =>
      buildSpecToPrPrompt({
        workingDirectory: "/tmp/project",
        deliveryMode: "feature",
      }),
    ).toThrow(/concrete prompt/);
  });

  it("limits feature validation to one targeted E2E and one video", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "feature",
      changeKind: "feature",
      publication: "draft",
      prompt: "Add user-facing checkout.",
    });

    expect(prompt).toContain('mode: "feature"');
    expect(prompt).toContain("exactly one .webm or .mp4");
    expect(prompt).toContain("Never run the full-project E2E suite by default");
    expect(prompt).toContain("featureEvidence");
    expect(prompt).toContain("positive testCount");
    expect(prompt).toContain("non-target codex/<short-slug>");
    expect(prompt).toContain("commit all intended changes");
  });

  it("uses connected Figma intake and does not publish by default for Figma-only delivery", () => {
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      deliveryMode: "figma",
      changeKind: "design",
      figmaUrl: "https://figma.com/design/example",
    });

    expect(prompt).toContain('mode: "figma"');
    expect(prompt).toContain('publication: "none"');
    expect(prompt).toContain("connected Figma capability");
    expect(prompt).toContain("figma-bundle");
    expect(prompt).toContain("before contracts");
  });
});
