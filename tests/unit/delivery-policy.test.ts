import { describe, expect, it } from "vitest";

import { buildDelegationPolicy, buildDeliveryProfile } from "../../src/workflow/index.js";
import { resolveDeliveryPolicy } from "../../src/workflow/delivery-mode-policy.js";

const uiScope = {
  code: true,
  ui: true,
  api: false,
  specification: false,
  hasVisualBaseline: false,
  securitySensitive: false,
  performanceSensitive: false,
  observabilityRequested: false,
};

const fullDeliverySources = {
  briefPath: "briefs/checkout.md",
  figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
  openApiPaths: ["docs/openapi.yaml"],
};

describe("delivery policy", () => {
  it("resolves one explicit four-mode matrix including section applicability", () => {
    const brief = resolveDeliveryPolicy({
      mode: "brief",
      hasOpenApi: true,
      legacyApiOperationCount: 0,
      ui: true,
      workload: "M",
    });
    const feature = resolveDeliveryPolicy({
      mode: "feature",
      hasOpenApi: true,
      legacyApiOperationCount: 0,
      ui: true,
      workload: "L",
    });
    const figma = resolveDeliveryPolicy({
      mode: "figma",
      hasOpenApi: false,
      legacyApiOperationCount: 0,
      ui: true,
      workload: "XL",
    });
    const emptyLegacy = resolveDeliveryPolicy({
      mode: "legacy",
      hasOpenApi: false,
      legacyApiOperationCount: 0,
      ui: true,
      workload: "S",
    });
    const apiLegacy = resolveDeliveryPolicy({
      mode: "legacy",
      hasOpenApi: false,
      legacyApiOperationCount: 2,
      ui: true,
      workload: "M",
    });

    expect(brief).toMatchObject({
      requireApiReady: true,
      requirements: { apiCoverage: true, performanceEvidence: true, featureVideo: false },
      sectionApplicability: { api: true, legacy: false, visual: true, performance: true },
      parallelReviewers: false,
    });
    expect(feature).toMatchObject({
      requireApiReady: true,
      requirements: { targetedFeatureE2E: true, featureVideo: true },
      parallelReviewers: true,
    });
    expect(figma).toMatchObject({
      requireApiReady: false,
      requirements: { mockData: true, apiCoverage: false, performanceEvidence: false },
      sectionApplicability: { api: false, visual: true, performance: false },
      parallelReviewers: true,
    });
    expect(emptyLegacy).toMatchObject({
      requireApiReady: false,
      requirements: { apiCoverage: false, legacyInventory: true },
      sectionApplicability: { api: true, legacy: true, performance: true },
    });
    expect(apiLegacy).toMatchObject({
      requireApiReady: true,
      requirements: { apiCoverage: true },
    });
    expect(apiLegacy.modeValidations).toEqual(
      expect.arrayContaining(["api-ready", "api-coverage"]),
    );
    expect(() =>
      resolveDeliveryPolicy({
        mode: "brief",
        hasOpenApi: false,
        legacyApiOperationCount: 0,
        ui: true,
        workload: "M",
      }),
    ).toThrow(/OpenAPI/);
  });
  it("derives a strict bounded single-writer delegation policy from workload size", () => {
    expect(buildDelegationPolicy("XS")).toEqual({
      singleWriter: true,
      allowNested: false,
      maxReadOnlyScouts: 0,
      parallelReviewers: false,
    });
    expect(buildDelegationPolicy("S").maxReadOnlyScouts).toBe(0);
    expect(buildDelegationPolicy("M").maxReadOnlyScouts).toBeLessThanOrEqual(1);
    for (const size of ["L", "XL"] as const) {
      expect(buildDelegationPolicy(size)).toMatchObject({
        singleWriter: true,
        allowNested: false,
        maxReadOnlyScouts: 2,
        parallelReviewers: true,
      });
    }
  });

  it("keeps auto mode lightweight for existing callers", () => {
    expect(
      buildDeliveryProfile({
        mode: "auto",
        changeKind: "auto",
        publication: "draft",
        scope: { ...uiScope, ui: false },
      }),
    ).toMatchObject({
      mode: "auto",
      recommendedSkills: [],
      requirements: {
        brief: false,
        legacyBaseline: false,
        legacyInventory: false,
        targetedFeatureE2E: false,
        featureVideo: false,
        figmaBundle: false,
        visualComparison: false,
        apiCoverage: false,
        performanceEvidence: false,
        mockData: false,
      },
    });
  });

  it("requires brief, Figma, and OpenAPI sources for full delivery", () => {
    for (const missing of ["briefPath", "figmaUrl", "openApiPaths"] as const) {
      const sources = { ...fullDeliverySources };
      delete sources[missing];
      expect(() =>
        buildDeliveryProfile({
          mode: "brief",
          changeKind: "feature",
          publication: "draft",
          scope: uiScope,
          ...sources,
        }),
      ).toThrow(new RegExp(missing === "openApiPaths" ? "OpenAPI" : missing, "i"));
    }

    expect(
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
        ...fullDeliverySources,
      }),
    ).toMatchObject({
      mode: "brief",
      requirements: {
        brief: true,
        figmaBundle: true,
        visualComparison: true,
        apiCoverage: true,
        performanceEvidence: true,
        targetedFeatureE2E: false,
        featureVideo: false,
      },
    });

    expect(() =>
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
        briefPath: fullDeliverySources.briefPath,
        figmaUrl: fullDeliverySources.figmaUrl,
        openApiUrls: ["https://api.example.com/openapi.yaml"],
      }),
    ).not.toThrow();
  });

  it("requires a separate legacy project and the full migration evidence contract", () => {
    expect(() =>
      buildDeliveryProfile({
        mode: "legacy",
        changeKind: "migration",
        publication: "draft",
        scope: uiScope,
      }),
    ).toThrow(/legacyProjectRoot/);

    expect(
      buildDeliveryProfile({
        mode: "legacy",
        changeKind: "migration",
        publication: "draft",
        scope: uiScope,
        legacyProjectRoot: "/tmp/legacy-app",
      }).requirements,
    ).toEqual({
      brief: false,
      legacyBaseline: true,
      legacyInventory: true,
      targetedFeatureE2E: false,
      featureVideo: false,
      figmaBundle: false,
      visualComparison: true,
      apiCoverage: false,
      performanceEvidence: true,
      mockData: false,
    });
  });

  it("requires the draft review bundle only when legacy publication is draft", () => {
    const draft = buildDeliveryProfile({
      mode: "legacy",
      changeKind: "migration",
      publication: "draft",
      scope: uiScope,
      legacyProjectRoot: "/tmp/legacy-app",
    });
    const localOnly = buildDeliveryProfile({
      mode: "legacy",
      changeKind: "migration",
      publication: "none",
      scope: uiScope,
      legacyProjectRoot: "/tmp/legacy-app",
    });

    expect(draft.draftEvidenceBundle).toBeDefined();
    expect(localOnly.draftEvidenceBundle).toBeUndefined();
  });

  it("makes feature inherit full delivery and add only targeted E2E plus one video", () => {
    expect(
      buildDeliveryProfile({
        mode: "feature",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
        ...fullDeliverySources,
      }).requirements,
    ).toMatchObject({
      brief: true,
      figmaBundle: true,
      visualComparison: true,
      apiCoverage: true,
      performanceEvidence: true,
      targetedFeatureE2E: true,
      featureVideo: true,
    });

    expect(
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
        ...fullDeliverySources,
      }).requirements,
    ).toMatchObject({ targetedFeatureE2E: false, featureVideo: false });

    expect(() =>
      buildDeliveryProfile({
        mode: "feature",
        changeKind: "feature",
        publication: "draft",
        scope: { ...uiScope, ui: false },
        ...fullDeliverySources,
      }),
    ).toThrow(/UI scope/);
  });

  it("requires Figma mock data and visual comparison without full-delivery costs", () => {
    expect(() =>
      buildDeliveryProfile({
        mode: "figma",
        changeKind: "design",
        publication: "draft",
        scope: uiScope,
      }),
    ).toThrow(/figmaUrl/);

    expect(
      buildDeliveryProfile({
        mode: "figma",
        changeKind: "design",
        publication: "draft",
        figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
        scope: uiScope,
      }),
    ).toMatchObject({
      mode: "figma",
      publication: "draft",
      requirements: {
        figmaBundle: true,
        visualComparison: true,
        mockData: true,
        apiCoverage: false,
        performanceEvidence: false,
        targetedFeatureE2E: false,
        featureVideo: false,
      },
    });

    expect(() =>
      buildDeliveryProfile({
        mode: "figma",
        changeKind: "design",
        publication: "draft",
        figmaUrl: "https://www.figma.com/design/abc/file",
        scope: { ...uiScope, ui: false },
      }),
    ).toThrow(/UI scope/);
  });

  it("composes feature sources and requires a Figma bundle whenever a URL is supplied", () => {
    expect(
      buildDeliveryProfile({
        mode: "feature",
        changeKind: "feature",
        publication: "draft",
        scope: { ...uiScope, api: true, hasVisualBaseline: true },
        briefPath: "briefs/checkout.md",
        figmaUrl: "https://www.figma.com/design/abc/file?node-id=1-2",
        docsPaths: ["docs/business-rules.md"],
        openApiPaths: ["docs/openapi.yaml"],
        guidancePaths: ["docs/architecture/ARCHITECTURE.md"],
        discoveredGuidancePaths: ["AGENTS.md"],
        skillHints: ["react-best-practices", "api-generator"],
        recommendedSkills: ["figma", "design-system", "api-generator", "playwright"],
      }),
    ).toMatchObject({
      mode: "feature",
      briefPath: "briefs/checkout.md",
      docsPaths: ["docs/business-rules.md"],
      openApiPaths: ["docs/openapi.yaml"],
      guidancePaths: ["docs/architecture/ARCHITECTURE.md"],
      discoveredGuidancePaths: ["AGENTS.md"],
      skillHints: ["react-best-practices", "api-generator"],
      recommendedSkills: ["figma", "design-system", "api-generator", "playwright"],
      requirements: {
        brief: true,
        targetedFeatureE2E: true,
        featureVideo: true,
        figmaBundle: true,
        visualComparison: true,
        apiCoverage: true,
        performanceEvidence: true,
      },
    });

    expect(
      buildDeliveryProfile({
        mode: "brief",
        changeKind: "feature",
        publication: "draft",
        scope: uiScope,
        ...fullDeliverySources,
      }).requirements,
    ).toMatchObject({
      targetedFeatureE2E: false,
      featureVideo: false,
      figmaBundle: true,
    });
  });
});
