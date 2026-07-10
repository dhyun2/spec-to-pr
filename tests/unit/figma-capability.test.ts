import { describe, expect, it } from "vitest";

import {
  deriveFigmaProviderPolicy,
  inferProviderKind,
  normalizeFigmaToolName,
} from "../../src/figma/figma-capability.js";

describe("Figma capability discovery", () => {
  it("normalizes Figma tool names", () => {
    expect(normalizeFigmaToolName("mcp__figma__get_metadata")).toBe("get_metadata");
    expect(normalizeFigmaToolName("figma.get_design_context")).toBe("get_design_context");
    expect(normalizeFigmaToolName("figma.get_code_connect_map")).toBe("get_code_connect_map");
  });

  it("infers local desktop provider kind", () => {
    expect(
      inferProviderKind({
        providerId: "figma-local",
        rawToolNames: ["get_metadata"],
      }),
    ).toBe("local-desktop");
  });

  it("derives local-first provider policy by capability", () => {
    const policy = deriveFigmaProviderPolicy([
      {
        providerId: "figma-remote",
        kind: "remote",
        available: true,
        transport: "http",
        tools: ["get_metadata", "get_design_context", "get_screenshot"],
        rawToolNames: [],
        notes: [],
      },
      {
        providerId: "figma-local",
        kind: "local-desktop",
        available: true,
        transport: "http",
        tools: ["get_metadata", "get_screenshot", "get_code_connect_map"],
        rawToolNames: [],
        notes: [],
      },
    ]);

    expect(policy.metadataProviderId).toBe("figma-local");
    expect(policy.screenshotProviderId).toBe("figma-local");
    expect(policy.designContextProviderId).toBe("figma-remote");
    expect(policy.codeConnectProviderId).toBe("figma-local");
    expect(policy.missingCapabilities).toContain("variable-defs");
  });
});
