import { describe, expect, it } from "vitest";

import {
  buildCodexPublishInstructions,
  buildCodexReviewAgentInstructions,
  buildCodexVisualRepairInstructions,
  CODEX_REVIEW_AGENT_PROFILES,
  DEFAULT_CODEX_VISUAL_REPAIR_POLICY,
} from "../../packages/codex-sdk/src/workflow-policy.js";

describe("Codex SDK workflow policy", () => {
  it("defines review agents that mirror the spec-to-pr review council lanes", () => {
    expect(CODEX_REVIEW_AGENT_PROFILES.map((profile) => profile.name)).toEqual([
      "visual-regression-reviewer",
      "accessibility-reviewer",
      "performance-reviewer",
      "security-hardening-reviewer",
      "observability-reviewer",
      "pr-report-reviewer",
    ]);

    expect(buildCodexReviewAgentInstructions()).toContain("Spawn Codex subagents");
    expect(buildCodexReviewAgentInstructions()).toContain("visual-regression-reviewer");
  });

  it("builds a bounded 90 percent visual repair loop instruction", () => {
    const instructions = buildCodexVisualRepairInstructions({
      minPassingScore: 0.9,
      maxAttempts: 3,
    });

    expect(DEFAULT_CODEX_VISUAL_REPAIR_POLICY.minPassingScore).toBe(0.9);
    expect(instructions).toContain("90.00%");
    expect(instructions).toContain("3 attempt");
    expect(instructions).toContain("evaluate_visual_repair_loop");
    expect(instructions).toContain("Do not publish");
  });

  it("tells Codex to publish draft review requests when the report is not blocked", () => {
    const prompt = buildCodexPublishInstructions();

    expect(prompt).toContain("publish_review_request");
    expect(prompt).toContain("draft PR/MR");
    expect(prompt).toContain("Do not merge");
    expect(prompt).toContain("mandatory gate evidence");
    expect(prompt).toContain('language: "ko"');
  });
});
