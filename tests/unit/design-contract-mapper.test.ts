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

  it("maps Figma components to @frontend/ui package exports before custom UI", () => {
    const result = buildFigmaDesignContract({
      runId,
      changeName: "deliver-mapfinder",
      generatedAt,
      figmaInventory: {
        components: [
          {
            nodeId: "238:941",
            name: "Button / Primary",
            type: "INSTANCE",
          },
        ],
        variables: [],
        textStyles: [],
        assets: [],
        artifactIds: [],
      },
      projectDesignSystem: {
        components: [
          {
            name: "Button",
            importPath: "@frontend/ui",
            filePath: "node_modules/@frontend/ui/dist/index.d.ts",
            source: "package-ui",
          },
        ],
        tokens: [],
        scannedPaths: ["node_modules/@frontend/ui"],
      },
      evidence: [],
    });

    expect(result.contract.componentMappings[0]).toMatchObject({
      codeComponent: "Button",
      importPath: "@frontend/ui",
      source: "name-match",
      confidence: "medium",
    });
    expect(result.gaps).toHaveLength(0);
  });

  it("generates component contracts with Figma metrics, variants, and visual acceptance", () => {
    const result = buildFigmaDesignContract({
      runId,
      changeName: "deliver-mapfinder-store-card",
      generatedAt,
      figmaInventory: {
        components: [
          {
            nodeId: "2252:5509",
            name: "StoreCard / Compact",
            type: "COMPONENT",
            width: 328,
            height: 116,
            paddingTop: 12,
            paddingRight: 16,
            paddingBottom: 12,
            paddingLeft: 16,
            itemSpacing: 8,
            borderRadius: 8,
            shadow: "0 2 8 rgba(0,0,0,0.12)",
            variantProperties: {
              size: "compact",
              state: "default",
            },
            codeConnect: {
              component: "StoreCard",
              importPath: "@/pages/mapfinder/components/store-card",
              props: {
                variant: "compact",
                density: "compact",
              },
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

    expect(result.contract.componentContracts[0]).toMatchObject({
      figmaNodeId: "2252:5509",
      figmaName: "StoreCard / Compact",
      codeComponent: "StoreCard",
      variantKey: "size=compact;state=default",
      acceptance: {
        comparisonScope: "component",
        minReviewMatch: 0.97,
      },
    });
    expect(result.contract.componentContracts[0]!.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "width", value: 328 }),
        expect.objectContaining({ name: "height", value: 116 }),
        expect.objectContaining({ name: "paddingTop", value: 12 }),
        expect.objectContaining({ name: "borderRadius", value: 8 }),
      ]),
    );
    expect(result.contract.componentContracts[0]!.propMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          figmaProp: "size",
          figmaValue: "compact",
          codeProp: "variant",
          codeValue: "compact",
        }),
      ]),
    );
  });
});
