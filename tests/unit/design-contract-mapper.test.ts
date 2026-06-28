import { describe, expect, it } from "vitest";

import { buildFigmaDesignContract } from "../../src/design-contract/design-contract-mapper.js";

const runId = "run_11111111111111111111111111111111";
const generatedAt = "2026-06-23T00:00:00.000Z";

describe("Figma design contract mapper", () => {
  it("uses Code Connect mappings with high confidence", () => {
    const result = buildFigmaDesignContract({
      runId,
      changeName: "deliver-reservation-management",
      generatedAt,
      figmaInventory: {
        components: [
          {
            nodeId: "238:941",
            name: "Button / Primary",
            type: "INSTANCE",
            codeConnect: {
              component: "Button",
              importPath: "@/shared/ui/button",
            },
          },
        ],
        variables: [],
        textStyles: [],
        assets: [],
        artifactIds: [],
      },
      projectDesignSystem: {
        components: [],
        tokens: [],
        scannedPaths: [],
      },
      evidence: [],
    });

    expect(result.contract.componentMappings[0]).toMatchObject({
      codeComponent: "Button",
      source: "code-connect",
      confidence: "high",
    });
    expect(result.gaps).toHaveLength(0);
  });

  it("creates design gaps for missing component mappings", () => {
    const result = buildFigmaDesignContract({
      runId,
      changeName: "deliver-reservation-management",
      generatedAt,
      figmaInventory: {
        components: [
          {
            nodeId: "238:941",
            name: "Unknown Component",
            type: "INSTANCE",
          },
        ],
        variables: [],
        textStyles: [],
        assets: [],
        artifactIds: [],
      },
      projectDesignSystem: {
        components: [],
        tokens: [],
        scannedPaths: [],
      },
      evidence: [],
    });

    expect(result.contract.componentMappings[0]!.confidence).toBe("missing");
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]!.category).toBe("design");
  });
});
