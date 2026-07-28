import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import * as figmaContract from "../../src/figma/figma-capture-contract.js";
import {
  assertCompleteDesignMapping,
  assertExactFigmaImplementationBindings,
  type FigmaDesignMapping,
} from "../../src/figma/figma-capture-contract.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const otherDigest = `sha256:${"b".repeat(64)}` as const;
const barrelDigest = `sha256:${"c".repeat(64)}` as const;
const codeConnectDigest = `sha256:${"d".repeat(64)}` as const;
const logo = { name: "Logo/Normal/nxplus_park", nodeId: "1:2" };

const spotBinding = {
  id: "icon-normal-spot",
  figmaComponent: "icon/normal/spot",
  nodeId: "10:20",
  role: "icon" as const,
  resolution: {
    kind: "component" as const,
    module: "@frontend/ui/icons/vue" as const,
    exportName: "Spot",
    props: {
      size: 16,
      color: "--semantic-text-tertiary",
      state: "normal",
    },
  },
  semanticTokens: [
    {
      role: "icon" as const,
      figmaVariable: "semantic/text/tertiary",
      codeToken: "--semantic-text-tertiary",
    },
  ],
  expectedGeometry: {
    width: 16,
    height: 16,
    alignment: "center",
    flexShrink: 0,
  },
};

const circleBinding = {
  ...spotBinding,
  id: "icon-status-circle",
  figmaComponent: "icon/status/circle",
  nodeId: "10:21",
  resolution: {
    ...spotBinding.resolution,
    exportName: "Circle",
    props: {
      size: 16,
      color: "--semantic-status-positive",
      state: "available",
    },
  },
  semanticTokens: [
    {
      role: "icon" as const,
      figmaVariable: "semantic/status/positive",
      codeToken: "--semantic-status-positive",
    },
  ],
};

const closeBinding = {
  ...spotBinding,
  id: "icon-status-close",
  figmaComponent: "icon/status/close",
  nodeId: "10:22",
  resolution: {
    ...spotBinding.resolution,
    exportName: "Close",
    props: {
      size: 16,
      color: "--semantic-status-negative",
      state: "unavailable",
    },
  },
  semanticTokens: [
    {
      role: "icon" as const,
      figmaVariable: "semantic/status/negative",
      codeToken: "--semantic-status-negative",
    },
  ],
};

const copyButtonBinding = {
  id: "copy-button",
  figmaComponent: "button/copy",
  nodeId: "10:23",
  role: "component" as const,
  resolution: {
    kind: "component" as const,
    module: "@frontend/ui" as const,
    exportName: "IconButton",
    props: {
      shape: "square",
      variant: "outline",
      size: "small",
    },
  },
  semanticTokens: [
    {
      role: "border" as const,
      figmaVariable: "semantic/border/primary",
      codeToken: "var(--semantic-border-primary)",
    },
  ],
  expectedGeometry: {
    width: 32,
    height: 32,
    alignment: "center",
    flexShrink: 0,
  },
};

const publicApiCatalogFields = {
  schemaVersion: "figma-public-api-catalog-v1" as const,
  packageName: "@frontend/ui" as const,
  packageVersion: "1.2.3",
  publicBarrels: [
    {
      module: "@frontend/ui" as const,
      path: "tests/fixtures/case4-figma/ui-consumer/index.js",
      digest: barrelDigest,
    },
    {
      module: "@frontend/ui/icons/vue" as const,
      path: "tests/fixtures/case4-figma/ui-consumer/icons/vue.js",
      digest: barrelDigest,
    },
  ],
  codeConnectManifest: {
    path: "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json",
    digest: codeConnectDigest,
  },
  exports: [spotBinding, circleBinding, closeBinding, copyButtonBinding].map((binding) => ({
    figmaComponent: binding.figmaComponent,
    nodeId: binding.nodeId,
    module: binding.resolution.module,
    exportName: binding.resolution.exportName,
    allowedProps: Object.keys(binding.resolution.props),
  })),
};
const publicApiCatalog = {
  ...publicApiCatalogFields,
  digest: figmaContract.figmaPublicApiCatalogDigest(publicApiCatalogFields),
};
const designSystem = {
  packageName: "@frontend/ui" as const,
  packageVersion: "1.2.3",
  catalogDigest: publicApiCatalog.digest,
  guidanceSkill: "@frontend/codex-skill-design-system",
};

function mapping(
  components: FigmaDesignMapping["components"] = [
    spotBinding,
    circleBinding,
    closeBinding,
    copyButtonBinding,
  ],
): FigmaDesignMapping {
  return {
    designSystem,
    publicApiCatalog,
    components,
    fonts: [],
    tokens: [],
  };
}

function componentUsage(
  binding:
    typeof spotBinding | typeof circleBinding | typeof closeBinding | typeof copyButtonBinding,
) {
  if (binding.resolution.kind !== "component") throw new Error("Expected component binding");
  return {
    mappingId: binding.id,
    sourceFile: "src/checkout.vue",
    resolution: {
      kind: "component" as const,
      module: binding.resolution.module,
      exportName: binding.resolution.exportName,
      appliedProps: binding.resolution.props,
      tokenUsages: binding.semanticTokens,
      observedGeometry: binding.expectedGeometry,
    },
  };
}

describe("Figma design mapping", () => {
  it("requires every captured component to resolve explicitly", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [logo],
        mapping: mapping([]),
      }),
    ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE/);
  });

  it("accepts an explicit digest-bound canonical asset mapping", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [logo],
        mapping: mapping([
          {
            id: "nxplus-park-logo",
            figmaComponent: logo.name,
            nodeId: logo.nodeId,
            role: "component",
            resolution: {
              kind: "asset",
              path: "assets/nxplus_park.webp",
              digest,
            },
            semanticTokens: [],
          },
        ]),
      }),
    ).not.toThrow();
  });

  it("binds spot, circle, and close to exact public exports, state props, and token formats", () => {
    const iconMapping = mapping([spotBinding, circleBinding, closeBinding]);
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [
          { name: spotBinding.figmaComponent, nodeId: spotBinding.nodeId },
          { name: circleBinding.figmaComponent, nodeId: circleBinding.nodeId },
          { name: closeBinding.figmaComponent, nodeId: closeBinding.nodeId },
        ],
        mapping: iconMapping,
      }),
    ).not.toThrow();
    expect(() =>
      assertExactFigmaImplementationBindings({
        mapping: iconMapping,
        usages: [
          componentUsage(spotBinding),
          componentUsage(circleBinding),
          componentUsage(closeBinding),
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an external SVG substitute without an explicit exception", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [{ name: spotBinding.figmaComponent, nodeId: spotBinding.nodeId }],
        mapping: mapping([
          {
            ...spotBinding,
            resolution: {
              kind: "asset",
              path: "https://icons.example/spot.svg",
              digest,
            },
          },
        ]),
      }),
    ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE|repository-relative/i);
  });

  it("rejects repository assets and missing icon-role tokens as icon substitutes", () => {
    for (const binding of [
      {
        ...spotBinding,
        resolution: {
          kind: "asset" as const,
          path: "assets/spot.svg",
          digest,
        },
      },
      {
        ...spotBinding,
        semanticTokens: [
          {
            role: "text" as const,
            figmaVariable: "semantic/text/tertiary",
            codeToken: "var(--semantic-text-tertiary)",
          },
        ],
      },
    ]) {
      expect(() =>
        assertCompleteDesignMapping({
          capturedComponents: [{ name: binding.figmaComponent, nodeId: binding.nodeId }],
          mapping: mapping([binding]),
        }),
      ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE.*icon|component|semantic token/i);
    }
  });

  it("requires a digest-bound @frontend/ui public API and Code Connect catalog", () => {
    const digestFunction = Reflect.get(figmaContract, "figmaPublicApiCatalogDigest");
    expect(typeof digestFunction).toBe("function");
    if (typeof digestFunction !== "function") return;

    const catalogFields = {
      schemaVersion: "figma-public-api-catalog-v1" as const,
      packageName: "@frontend/ui" as const,
      packageVersion: "1.2.3",
      publicBarrels: [
        {
          module: "@frontend/ui/icons/vue" as const,
          path: "tests/fixtures/case4-figma/ui-consumer/icons/vue.js",
          digest: barrelDigest,
        },
      ],
      codeConnectManifest: {
        path: "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json",
        digest: codeConnectDigest,
      },
      exports: [
        {
          figmaComponent: spotBinding.figmaComponent,
          nodeId: spotBinding.nodeId,
          module: spotBinding.resolution.module,
          exportName: spotBinding.resolution.exportName,
          allowedProps: ["color", "size", "state"],
        },
      ],
    };
    const publicApiCatalog = {
      ...catalogFields,
      digest: digestFunction(catalogFields),
    };
    const exactMapping = {
      ...mapping([spotBinding]),
      designSystem: {
        ...designSystem,
        catalogDigest: publicApiCatalog.digest,
      },
      publicApiCatalog,
    };

    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [{ name: spotBinding.figmaComponent, nodeId: spotBinding.nodeId }],
        mapping: exactMapping,
      }),
    ).not.toThrow();

    for (const invalidMapping of [
      {
        ...exactMapping,
        designSystem: { ...exactMapping.designSystem, packageName: "@similar/ui" },
      },
      {
        ...exactMapping,
        components: [
          {
            ...spotBinding,
            resolution: {
              ...spotBinding.resolution,
              props: { ...spotBinding.resolution.props, invented: true },
            },
          },
        ],
      },
      {
        ...exactMapping,
        publicApiCatalog: {
          ...publicApiCatalog,
          digest: `sha256:${createHash("sha256").update("tampered").digest("hex")}`,
        },
      },
    ]) {
      expect(() =>
        assertCompleteDesignMapping({
          capturedComponents: [{ name: spotBinding.figmaComponent, nodeId: spotBinding.nodeId }],
          mapping: invalidMapping as FigmaDesignMapping,
        }),
      ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE|catalog|frontend\/ui|prop/i);
    }
  });

  it("rejects raw colors and swapped CSS/icon semantic-token formats", () => {
    for (const binding of [
      {
        ...spotBinding,
        resolution: {
          ...spotBinding.resolution,
          props: { ...spotBinding.resolution.props, color: "#777777" },
        },
        semanticTokens: [{ ...spotBinding.semanticTokens[0]!, codeToken: "#777777" }],
      },
      {
        ...spotBinding,
        resolution: {
          ...spotBinding.resolution,
          props: {
            ...spotBinding.resolution.props,
            color: "var(--semantic-text-tertiary)",
          },
        },
        semanticTokens: [
          {
            ...spotBinding.semanticTokens[0]!,
            codeToken: "var(--semantic-text-tertiary)",
          },
        ],
      },
      {
        ...copyButtonBinding,
        semanticTokens: [
          {
            ...copyButtonBinding.semanticTokens[0]!,
            codeToken: "--semantic-border-primary",
          },
        ],
      },
    ]) {
      expect(() =>
        assertCompleteDesignMapping({
          capturedComponents: [{ name: binding.figmaComponent, nodeId: binding.nodeId }],
          mapping: mapping([binding]),
        }),
      ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE.*semantic|token|color/i);
    }
  });

  it("rejects wrong component variants and props in implementation evidence", () => {
    const usage = componentUsage(copyButtonBinding);
    expect(() =>
      assertExactFigmaImplementationBindings({
        mapping: mapping([copyButtonBinding]),
        usages: [
          {
            ...usage,
            resolution: {
              ...usage.resolution,
              appliedProps: {
                ...usage.resolution.appliedProps,
                variant: "fill",
              },
            },
          },
        ],
      }),
    ).toThrow(/FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID.*copy-button/i);
  });

  it("rejects icon width, height, alignment, and flex-shrink drift", () => {
    const usage = componentUsage(spotBinding);
    for (const observedGeometry of [
      { ...spotBinding.expectedGeometry, width: 15 },
      { ...spotBinding.expectedGeometry, height: 15 },
      { ...spotBinding.expectedGeometry, alignment: "baseline" },
      { ...spotBinding.expectedGeometry, flexShrink: 1 },
    ]) {
      expect(() =>
        assertExactFigmaImplementationBindings({
          mapping: mapping([spotBinding]),
          usages: [
            {
              ...usage,
              resolution: { ...usage.resolution, observedGeometry },
            },
          ],
        }),
      ).toThrow(/FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID.*icon-normal-spot/i);
    }
  });

  it("rejects missing, unknown, and duplicate mapping IDs in implementation evidence", () => {
    const usage = componentUsage(spotBinding);
    for (const usages of [[], [{ ...usage, mappingId: "unknown-icon" }], [usage, usage]]) {
      expect(() =>
        assertExactFigmaImplementationBindings({
          mapping: mapping([spotBinding]),
          usages,
        }),
      ).toThrow(/FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID/);
    }
  });

  it("exact-matches canonical asset digests and explicit exception reasons", () => {
    const asset = {
      id: "nxplus-park-logo",
      figmaComponent: logo.name,
      nodeId: logo.nodeId,
      role: "component" as const,
      resolution: {
        kind: "asset" as const,
        path: "assets/nxplus_park.webp",
        digest,
      },
      semanticTokens: [],
    };
    const exception = {
      id: "unpublished-status-glyph",
      figmaComponent: "icon/status/unpublished",
      nodeId: "10:24",
      role: "icon" as const,
      resolution: {
        kind: "exception" as const,
        reason: "The internal icon package does not publish this verified glyph.",
        unavailableExport: {
          requestedModule: "@frontend/ui/icons/vue" as const,
          requestedExport: "UnpublishedStatusGlyph",
          catalogDigest: publicApiCatalog.digest,
        },
        substitute: {
          path: "assets/unpublished-status.svg",
          digest,
          size: 16,
          color: "--semantic-status-negative",
        },
      },
      semanticTokens: [
        {
          role: "icon" as const,
          figmaVariable: "semantic/status/negative",
          codeToken: "--semantic-status-negative",
        },
      ],
      expectedGeometry: {
        width: 16,
        height: 16,
        alignment: "center",
        flexShrink: 0,
      },
    };
    expect(() =>
      assertExactFigmaImplementationBindings({
        mapping: mapping([asset, exception]),
        usages: [
          {
            mappingId: asset.id,
            sourceFile: "src/checkout.vue",
            resolution: {
              kind: "asset",
              path: asset.resolution.path,
              digest: otherDigest,
            },
          },
          {
            mappingId: exception.id,
            sourceFile: "src/checkout.vue",
            resolution: {
              kind: "exception",
              reason: "Used a similar external icon.",
              unavailableExport: exception.resolution.unavailableExport,
              substitute: exception.resolution.substitute,
            },
          },
        ],
      }),
    ).toThrow(/FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID/);
  });

  it("rejects duplicate, unbound, and node-mismatched mappings", () => {
    for (const components of [
      [spotBinding, spotBinding],
      [{ ...spotBinding, figmaComponent: "Unknown/Card", nodeId: "9:9" }],
      [{ ...spotBinding, nodeId: "9:9" }],
    ]) {
      expect(() =>
        assertCompleteDesignMapping({
          capturedComponents: [{ name: spotBinding.figmaComponent, nodeId: spotBinding.nodeId }],
          mapping: mapping(components),
        }),
      ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE/);
    }
  });

  it("rejects mutable package labels and empty exception reasons", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [logo],
        mapping: {
          ...mapping([
            {
              id: "logo-exception",
              figmaComponent: logo.name,
              nodeId: logo.nodeId,
              role: "component",
              resolution: {
                kind: "exception",
                reason: " ",
                unavailableExport: {
                  requestedModule: "@frontend/ui",
                  requestedExport: "MissingLogo",
                  catalogDigest: publicApiCatalog.digest,
                },
                substitute: {
                  path: "assets/missing-logo.svg",
                  digest,
                  size: 16,
                  color: "--semantic-text-tertiary",
                },
              },
              semanticTokens: [],
            },
          ]),
          designSystem: { ...designSystem, packageVersion: "next" },
        },
      }),
    ).toThrow();
  });
});
