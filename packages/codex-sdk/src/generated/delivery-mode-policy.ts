// Generated from src/workflow/delivery-mode-policy.ts. Do not edit.
export type PrReportSectionId =
  | "api"
  | "legacy"
  | "visual"
  | "functional-review"
  | "design-review"
  | "performance"
  | "feature-evidence";

export type ModeRequirementSet = {
  brief: boolean;
  legacyBaseline: boolean;
  legacyInventory: boolean;
  targetedFeatureE2E: boolean;
  featureVideo: boolean;
  figmaBundle: boolean;
  visualComparison: boolean;
  apiCoverage: boolean;
  performanceEvidence: boolean;
  mockData: boolean;
};

export type ModeValidationId =
  | "legacy-baseline"
  | "legacy-inventory"
  | "targeted-feature-e2e"
  | "feature-video"
  | "figma-bundle"
  | "visual-comparison"
  | "api-coverage"
  | "performance-evidence"
  | "mock-data"
  | "api-ready";

export type DeliveryPolicyInput = {
  mode: "brief" | "legacy" | "feature" | "figma";
  hasOpenApi: boolean;
  legacyApiOperationCount: number;
  ui: boolean;
  workload: "XS" | "S" | "M" | "L" | "XL";
};

export type ResolvedDeliveryPolicy = {
  requirements: ModeRequirementSet;
  requireApiReady: boolean;
  modeValidations: readonly ModeValidationId[];
  sectionApplicability: Readonly<Record<PrReportSectionId, boolean>>;
  parallelReviewers: boolean;
};

export const VISUAL_POLICY = {
  reviewThreshold: 0.92,
  maxMaskedAreaRatio: 0.2,
  maxComparisonAttempts: 3,
} as const;

export function parallelReviewersForWorkload(_workload: DeliveryPolicyInput["workload"]): boolean {
  return true;
}

export function resolveDeliveryPolicy(input: DeliveryPolicyInput): ResolvedDeliveryPolicy {
  if (!input.ui) throw new Error(`${input.mode} mode requires UI scope`);
  if (!Number.isInteger(input.legacyApiOperationCount) || input.legacyApiOperationCount < 0) {
    throw new Error("legacyApiOperationCount must be a non-negative integer");
  }
  const fullDelivery = input.mode === "brief" || input.mode === "feature";
  if (fullDelivery && !input.hasOpenApi) {
    throw new Error(`${input.mode} mode requires at least one OpenAPI source`);
  }
  const legacy = input.mode === "legacy";
  const feature = input.mode === "feature";
  const figma = input.mode === "figma";
  // Legacy migration must discover and disclose API uncertainty, but it must not
  // require full API-ready artifacts before any implementation can begin. Full
  // operation coverage remains a delivery requirement for brief and feature.
  const apiCoverage = fullDelivery;
  const requirements: ModeRequirementSet = {
    brief: fullDelivery,
    legacyBaseline: legacy,
    legacyInventory: legacy,
    targetedFeatureE2E: feature,
    featureVideo: feature,
    figmaBundle: fullDelivery || figma,
    // Every UI mode, including legacy migration, has a runtime-owned visual
    // comparison. A failed comparison is reported as a Gap; it is never
    // silently disabled by the input mode.
    visualComparison: true,
    apiCoverage,
    performanceEvidence: fullDelivery,
    mockData: figma,
  };
  const modeValidations: ModeValidationId[] = [];
  if (requirements.legacyBaseline) modeValidations.push("legacy-baseline");
  if (requirements.legacyInventory) modeValidations.push("legacy-inventory");
  if (requirements.targetedFeatureE2E) modeValidations.push("targeted-feature-e2e");
  if (requirements.featureVideo) modeValidations.push("feature-video");
  if (requirements.figmaBundle) modeValidations.push("figma-bundle");
  if (requirements.visualComparison) modeValidations.push("visual-comparison");
  if (apiCoverage) modeValidations.push("api-coverage");
  if (requirements.performanceEvidence) modeValidations.push("performance-evidence");
  if (requirements.mockData) modeValidations.push("mock-data");
  const requireApiReady = fullDelivery;
  if (requireApiReady) modeValidations.push("api-ready");

  return {
    requirements,
    requireApiReady,
    modeValidations,
    sectionApplicability: {
      // Legacy API candidates and unresolved call-sites belong in the report
      // even when they are not complete enough to require api-ready evidence.
      api: fullDelivery || legacy,
      legacy,
      visual: true,
      "functional-review": true,
      "design-review": input.ui,
      performance: requirements.performanceEvidence,
      "feature-evidence": feature,
    },
    parallelReviewers: parallelReviewersForWorkload(input.workload),
  };
}
