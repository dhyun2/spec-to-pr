import { describe, expect, it } from "vitest";

import { assertCompleteDesignMapping } from "../../src/figma/figma-capture-contract.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const designSystem = {
  packageName: "@frontend/ui",
  packageVersion: "1.2.3",
  guidanceSkill: "@frontend/codex-skill-design-system",
};
const logo = { name: "Logo/Normal/nxplus_park", nodeId: "1:2" };

describe("Figma design mapping", () => {
  it("requires every captured component to resolve explicitly", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [logo],
        mapping: { designSystem, components: [], fonts: [], tokens: [] },
      }),
    ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE/);
  });

  it("accepts an explicit digest-bound canonical asset mapping", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [logo],
        mapping: {
          designSystem,
          components: [
            {
              figmaComponent: logo.name,
              nodeId: logo.nodeId,
              resolution: {
                kind: "asset",
                path: "assets/nxplus_park.webp",
                digest,
              },
            },
          ],
          fonts: [],
          tokens: [],
        },
      }),
    ).not.toThrow();
  });

  it("rejects duplicate, unbound, and node-mismatched mappings", () => {
    const resolution = {
      kind: "component" as const,
      module: "@frontend/ui",
      exportName: "NxplusParkLogo",
    };
    for (const components of [
      [
        { figmaComponent: logo.name, nodeId: logo.nodeId, resolution },
        { figmaComponent: logo.name, nodeId: logo.nodeId, resolution },
      ],
      [{ figmaComponent: "Unknown/Card", nodeId: "9:9", resolution }],
      [{ figmaComponent: logo.name, nodeId: "9:9", resolution }],
    ]) {
      expect(() =>
        assertCompleteDesignMapping({
          capturedComponents: [logo],
          mapping: { designSystem, components, fonts: [], tokens: [] },
        }),
      ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE/);
    }
  });

  it("rejects mutable package labels and empty exception reasons", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [logo],
        mapping: {
          designSystem: { ...designSystem, packageVersion: "next" },
          components: [
            {
              figmaComponent: logo.name,
              nodeId: logo.nodeId,
              resolution: { kind: "exception", reason: " " },
            },
          ],
          fonts: [],
          tokens: [],
        },
      }),
    ).toThrow();
  });
});
