import { describe, expect, it } from "vitest";

import {
  getAgentDescriptor,
  listAgentDescriptors,
  RuntimeAgentKindSchema,
} from "../../src/agent-runtime/agent-descriptor.js";

describe("agent descriptors", () => {
  it("lists all implementation agents", () => {
    expect(listAgentDescriptors().map((descriptor) => descriptor.agent)).toEqual([
      "spec-bdd",
      "api-contract",
      "design-ui",
      "integrator",
    ]);
  });

  it("describes design-ui with Figma contract requirements", () => {
    const descriptor = getAgentDescriptor("design-ui");

    expect(descriptor.displayName).toBe("Design/UI Agent");
    expect(descriptor.requiredArtifacts).toContain("figma-design-contract");
    expect(descriptor.expectedOutputs).toContain("Fixture route or story");
  });

  it("rejects non-implementation runtime agents", () => {
    expect(RuntimeAgentKindSchema.safeParse("review-council").success).toBe(false);
  });
});
