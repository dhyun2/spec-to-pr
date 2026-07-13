import { describe, expect, it } from "vitest";

import {
  getAgentDescriptor,
  listAgentDescriptors,
  RuntimeAgentKindSchema,
} from "../../src/agent-runtime/agent-descriptor.js";

describe("agent descriptors", () => {
  it("lists one shared implementation agent", () => {
    expect(listAgentDescriptors().map((descriptor) => descriptor.agent)).toEqual([
      "implementation",
    ]);
  });

  it("describes implementation with API and Figma contract requirements", () => {
    const descriptor = getAgentDescriptor("implementation");

    expect(descriptor.displayName).toBe("Implementation Agent");
    expect(descriptor.requiredArtifacts).toContain("api-contract-report");
    expect(descriptor.requiredArtifacts).toContain("figma-design-contract");
    expect(descriptor.expectedOutputs).toContain("Fixture route or story");
  });

  it("rejects non-implementation runtime agents", () => {
    expect(RuntimeAgentKindSchema.safeParse("api-contract").success).toBe(false);
    expect(RuntimeAgentKindSchema.safeParse("design-ui").success).toBe(false);
    expect(RuntimeAgentKindSchema.safeParse("review-council").success).toBe(false);
  });
});
