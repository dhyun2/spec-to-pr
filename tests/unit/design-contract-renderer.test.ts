import { describe, expect, it } from "vitest";

import { renderDesignContract } from "../../src/design-contract/design-contract-renderer.js";
import type { FigmaDesignContract } from "../../src/design-contract/design-contract-model.js";

const contract: FigmaDesignContract = {
  schemaVersion: "figma-design-contract-v1",
  runId: "run_11111111111111111111111111111111",
  changeName: "deliver-reservation-management",
  generatedAt: "2026-06-23T00:00:00.000Z",
  sourceArtifactIds: [],
  componentMappings: [],
  componentContracts: [],
  tokenMappings: [],
  typographyMappings: [],
  assetMappings: [],
  gapIds: [],
  gapSummary: {
    unmappedComponents: 0,
    unmappedTokens: 0,
    unmappedTypography: 0,
    unmappedAssets: 0,
    blockerGaps: 0,
    majorGaps: 0,
  },
};

describe("Design contract renderer", () => {
  it("requires Figma style-like component props to map to UI-library variants or gaps", () => {
    const rendered = renderDesignContract({
      contract,
      gaps: [],
    });

    expect(rendered.uiImplementationRulesMd).toContain(
      "Normalize Figma style-like component props into supported UI-library variants",
    );
    expect(rendered.uiImplementationRulesMd).toContain(
      "record a design gap before using an explicit style override",
    );
  });

  it("renders component contracts and component-level visual gate instructions", () => {
    const rendered = renderDesignContract({
      contract: {
        ...contract,
        componentContracts: [
          {
            figmaNodeId: "2252:5509",
            figmaName: "StoreCard / Compact",
            codeComponent: "StoreCard",
            variantKey: "size=compact",
            metrics: [
              {
                name: "height",
                value: 116,
                unit: "px",
                tolerance: 1,
                source: "figma-node",
              },
            ],
            propMappings: [
              {
                figmaProp: "size",
                figmaValue: "compact",
                codeProp: "variant",
                codeValue: "compact",
                source: "code-connect",
                required: true,
              },
            ],
            acceptance: {
              comparisonScope: "component",
              minReviewMatch: 0.97,
              requiredStates: ["default"],
            },
            evidenceIds: [],
            gapIds: [],
          },
        ],
      },
      gaps: [],
    });

    expect(rendered.componentContractsJson).toContain("StoreCard / Compact");
    expect(rendered.contractMd).toContain("## Component Contracts");
    expect(rendered.uiImplementationRulesMd).toContain("component-contracts.json");
    expect(rendered.uiImplementationRulesMd).toContain("component-level visual comparison");
  });
});
