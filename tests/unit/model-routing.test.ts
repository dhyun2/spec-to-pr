import { describe, expect, it } from "vitest";

import { resolveModelRouting, type ModelRoutingRequest } from "../../src/workflow/model-routing.js";
import { resolveCodexModelRouting } from "../../packages/codex-sdk/src/model-routing.js";
import { buildSpecToPrPrompt } from "../../packages/codex-sdk/src/spec-to-pr-runner.js";

describe("1.0 model routing", () => {
  it("keeps the workflow core vendor-neutral while persisting the selected provider", () => {
    expect(resolveModelRouting({ provider: "claude" })).toMatchObject({
      provider: "claude",
      strategy: "adaptive-verified",
      qualityGaps: [],
    });
  });

  it("requires one exact model for pinned routing and all roles for custom routing", () => {
    expect(() =>
      resolveModelRouting({
        provider: "codex",
        routing: { strategy: "pinned" } as ModelRoutingRequest,
      }),
    ).toThrow(/pinnedModel/);
    expect(() =>
      resolveCodexModelRouting({ strategy: "custom", customModels: { fast: "small" } }),
    ).toThrow(/fastModel/);
  });

  it("maps Codex roles without mixing hosts and records reduced higher-role quality", () => {
    expect(resolveCodexModelRouting()).toMatchObject({
      models: { fast: "Luna", build: "Terra", expert: "Sol" },
      workflow: { strategy: "adaptive-verified", qualityGaps: [] },
    });
    expect(resolveCodexModelRouting({ unavailableRoles: ["expert"] })).toMatchObject({
      models: { fast: "Luna", build: "Terra", expert: "Terra" },
      workflow: {
        qualityGaps: [{ role: "expert", requestedModel: "Sol", actualModel: "Terra" }],
      },
    });
  });

  it("keeps a pinned model across all roles and carries routing into workflow_start", () => {
    expect(resolveCodexModelRouting({ strategy: "pinned", pinnedModel: "Terra" }).models).toEqual({
      fast: "Terra",
      build: "Terra",
      expert: "Terra",
    });
    const prompt = buildSpecToPrPrompt({
      workingDirectory: "/tmp/project",
      prompt: "Implement the settings screen.",
      modelRouting: { strategy: "pinned", pinnedModel: "Terra" },
    });
    expect(prompt).toContain(
      'modelRouting: {"strategy":"pinned","pinnedModel":"Terra","qualityGaps":[]}',
    );
    expect(prompt).toContain("never mix Codex and Claude");
    expect(prompt).toContain("Neither strategy weakens visual comparison");
  });
});
