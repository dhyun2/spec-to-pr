import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
const packageManifestDigest = `sha256:${"e".repeat(64)}` as const;
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
  packageManifest: {
    path: "tests/fixtures/case4-figma/ui-consumer/package.json",
    digest: packageManifestDigest,
  },
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

function publicApiAuthorityFixture(rootSource: string, iconSource: string) {
  const packagePath = "tests/fixtures/case4-figma/ui-consumer/package.json";
  const rootPath = "tests/fixtures/case4-figma/ui-consumer/index.js";
  const iconPath = "tests/fixtures/case4-figma/ui-consumer/icons/vue.js";
  const codeConnectPath = "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json";
  const packageBytes = Buffer.from(
    JSON.stringify({
      name: "@frontend/ui",
      version: "1.2.3",
      exports: { ".": "./index.js", "./icons/vue": "./icons/vue.js" },
    }),
  );
  const rootBytes = Buffer.from(rootSource);
  const iconBytes = Buffer.from(iconSource);
  const codeConnectBytes = Buffer.from(
    JSON.stringify({
      packageName: "@frontend/ui",
      packageVersion: "1.2.3",
      mappings: publicApiCatalogFields.exports,
    }),
  );
  const fields = {
    ...publicApiCatalogFields,
    packageManifest: {
      path: packagePath,
      digest: `sha256:${createHash("sha256").update(packageBytes).digest("hex")}` as const,
    },
    publicBarrels: [
      {
        module: "@frontend/ui" as const,
        path: rootPath,
        digest: `sha256:${createHash("sha256").update(rootBytes).digest("hex")}` as const,
      },
      {
        module: "@frontend/ui/icons/vue" as const,
        path: iconPath,
        digest: `sha256:${createHash("sha256").update(iconBytes).digest("hex")}` as const,
      },
    ],
    codeConnectManifest: {
      path: codeConnectPath,
      digest: `sha256:${createHash("sha256").update(codeConnectBytes).digest("hex")}` as const,
    },
  };
  const catalog = {
    ...fields,
    digest: figmaContract.figmaPublicApiCatalogDigest(fields),
  };
  return {
    mapping: {
      designSystem: { ...designSystem, catalogDigest: catalog.digest },
      publicApiCatalog: catalog,
      components: [],
      fonts: [],
      tokens: [],
    },
    evidence: [
      { path: packagePath, content: packageBytes },
      { path: rootPath, content: rootBytes },
      { path: iconPath, content: iconBytes },
      { path: codeConnectPath, content: codeConnectBytes },
    ],
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
      packageManifest: {
        path: "tests/fixtures/case4-figma/ui-consumer/package.json",
        digest: packageManifestDigest,
      },
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

  it("CALLER_CATALOG_AND_UNVERIFIED_VERSION_EXPORT_ACCEPTED", () => {
    const packageManifestBytes = Buffer.from(
      JSON.stringify({
        name: "@frontend/ui",
        version: "1.2.3",
        exports: {
          ".": "./index.js",
          "./icons/vue": "./icons/vue.js",
        },
      }),
    );
    const rootBarrelBytes = Buffer.from("export const IconButton = {};\n");
    const iconBarrelBytes = Buffer.from(
      "export const Spot = {}; export const Circle = {}; export const Close = {};\n",
    );
    const claimedCatalogFields = {
      ...publicApiCatalogFields,
      packageVersion: "999.0.0",
      packageManifest: {
        ...publicApiCatalogFields.packageManifest,
        digest:
          `sha256:${createHash("sha256").update(packageManifestBytes).digest("hex")}` as const,
      },
      publicBarrels: publicApiCatalogFields.publicBarrels.map((barrel) => ({
        ...barrel,
        digest: `sha256:${createHash("sha256")
          .update(barrel.module === "@frontend/ui" ? rootBarrelBytes : iconBarrelBytes)
          .digest("hex")}` as const,
      })),
      exports: [
        {
          figmaComponent: "button/invented",
          nodeId: "10:999",
          module: "@frontend/ui" as const,
          exportName: "DefinitelyNotInBarrel",
          allowedProps: ["size"],
        },
      ],
    };
    const codeConnectBytes = Buffer.from(
      JSON.stringify({
        packageName: "@frontend/ui",
        packageVersion: "999.0.0",
        mappings: claimedCatalogFields.exports,
      }),
    );
    claimedCatalogFields.codeConnectManifest = {
      ...claimedCatalogFields.codeConnectManifest,
      digest: `sha256:${createHash("sha256").update(codeConnectBytes).digest("hex")}`,
    };
    const claimedCatalog = {
      ...claimedCatalogFields,
      digest: figmaContract.figmaPublicApiCatalogDigest(claimedCatalogFields),
    };
    const claimedBinding = {
      id: "invented-button",
      figmaComponent: "button/invented",
      nodeId: "10:999",
      role: "component" as const,
      resolution: {
        kind: "component" as const,
        module: "@frontend/ui" as const,
        exportName: "DefinitelyNotInBarrel",
        props: { size: "small" },
      },
      semanticTokens: [],
    };
    const claimedMapping = {
      designSystem: {
        ...designSystem,
        packageVersion: "999.0.0",
        catalogDigest: claimedCatalog.digest,
      },
      publicApiCatalog: claimedCatalog,
      components: [claimedBinding],
      fonts: [],
      tokens: [],
    };
    const authorityValidator = Reflect.get(figmaContract, "assertFigmaPublicApiCatalogEvidence");

    expect(typeof authorityValidator).toBe("function");
    if (typeof authorityValidator !== "function") return;
    expect(() =>
      authorityValidator({
        mapping: claimedMapping,
        evidence: [
          {
            path: "tests/fixtures/case4-figma/ui-consumer/package.json",
            content: packageManifestBytes,
          },
          {
            path: "tests/fixtures/case4-figma/ui-consumer/index.js",
            content: rootBarrelBytes,
          },
          {
            path: "tests/fixtures/case4-figma/ui-consumer/icons/vue.js",
            content: iconBarrelBytes,
          },
          {
            path: "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json",
            content: codeConnectBytes,
          },
        ],
      }),
    ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE.*package|version|export|barrel/i);
  });

  it("parses the case4 fixture package, public barrels, and Code Connect manifest", () => {
    const packagePath = "tests/fixtures/case4-figma/ui-consumer/package.json";
    const rootBarrelPath = "tests/fixtures/case4-figma/ui-consumer/index.js";
    const iconBarrelPath = "tests/fixtures/case4-figma/ui-consumer/icons/vue.js";
    const manifestPath = "tests/fixtures/case4-figma/ui-consumer/code-connect.manifest.json";
    const evidence = [packagePath, rootBarrelPath, iconBarrelPath, manifestPath].map(
      (evidencePath) => ({
        path: evidencePath,
        content: readFileSync(evidencePath),
      }),
    );
    const codeConnect = JSON.parse(
      evidence.find((item) => item.path === manifestPath)!.content.toString("utf8"),
    ) as { mappings: typeof publicApiCatalogFields.exports };
    const fields = {
      ...publicApiCatalogFields,
      packageManifest: {
        path: packagePath,
        digest: digestOf(evidence, packagePath),
      },
      publicBarrels: [
        {
          module: "@frontend/ui" as const,
          path: rootBarrelPath,
          digest: digestOf(evidence, rootBarrelPath),
        },
        {
          module: "@frontend/ui/icons/vue" as const,
          path: iconBarrelPath,
          digest: digestOf(evidence, iconBarrelPath),
        },
      ],
      codeConnectManifest: {
        path: manifestPath,
        digest: digestOf(evidence, manifestPath),
      },
      exports: codeConnect.mappings,
    };
    const catalog = {
      ...fields,
      digest: figmaContract.figmaPublicApiCatalogDigest(fields),
    };
    const fixtureMapping = {
      designSystem: {
        ...designSystem,
        catalogDigest: catalog.digest,
      },
      publicApiCatalog: catalog,
      components: [],
      fonts: [],
      tokens: [],
    };

    expect(() =>
      figmaContract.assertFigmaPublicApiCatalogEvidence({
        mapping: fixtureMapping,
        evidence,
      }),
    ).not.toThrow();
  });

  it.each([
    "export interface Spot {}; export const Circle = {}; export const Close = {};",
    "export type Spot = {}; export const Circle = {}; export const Close = {};",
    "export type { Spot } from '../../index.js'; export const Circle = {}; export const Close = {};",
    "export declare const Spot: {}; export const Circle = {}; export const Close = {};",
    "export const enum Spot { Value }; export const Circle = {}; export const Close = {};",
    "export { Spot } from './missing.js'; export const Circle = {}; export const Close = {};",
  ])("rejects a non-runtime or unresolved public icon export: %s", (iconSource) => {
    const fixture = publicApiAuthorityFixture(
      "export const IconButton = {}; export const Spot = {};",
      iconSource,
    );

    expect(() => figmaContract.assertFigmaPublicApiCatalogEvidence(fixture)).toThrow(
      /FIGMA_DESIGN_MAPPING_INCOMPLETE|runtime|digest-bound|missing|real named barrel export/i,
    );
  });

  it("resolves a named re-export only through another digest-bound runtime barrel", () => {
    const fixture = publicApiAuthorityFixture(
      "export const IconButton = {}; export const Spot = {};",
      "export { Spot } from '../index.js'; export const Circle = {}; export const Close = {};",
    );

    expect(() => figmaContract.assertFigmaPublicApiCatalogEvidence(fixture)).not.toThrow();

    const typeOnlyTarget = publicApiAuthorityFixture(
      "export const IconButton = {}; export interface Spot {};",
      "export { Spot } from '../index.js'; export const Circle = {}; export const Close = {};",
    );
    expect(() => figmaContract.assertFigmaPublicApiCatalogEvidence(typeOnlyTarget)).toThrow(
      /real named barrel export/i,
    );
  });

  it("KNOWN_SPOT_EXCEPTION_SUBSTITUTION_ACCEPTED", () => {
    expect(() =>
      assertCompleteDesignMapping({
        capturedComponents: [{ name: spotBinding.figmaComponent, nodeId: spotBinding.nodeId }],
        mapping: mapping([
          {
            ...spotBinding,
            resolution: {
              kind: "exception",
              reason: "Use a nearby substitute.",
              unavailableExport: {
                requestedModule: "@frontend/ui/icons/vue",
                requestedExport: "SpotAlternate",
                catalogDigest: publicApiCatalog.digest,
              },
              substitute: {
                path: "assets/spot-alternate.svg",
                digest,
                size: 16,
                color: "--semantic-text-tertiary",
              },
            },
          },
        ]),
      }),
    ).toThrow(/FIGMA_DESIGN_MAPPING_INCOMPLETE.*known|Spot|component/i);
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

function digestOf(
  evidence: Array<{ path: string; content: Buffer }>,
  evidencePath: string,
): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(evidence.find((item) => item.path === evidencePath)!.content)
    .digest("hex")}`;
}
