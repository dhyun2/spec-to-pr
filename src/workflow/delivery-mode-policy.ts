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

export function parallelReviewersForWorkload(workload: DeliveryPolicyInput["workload"]): boolean {
  return workload === "L" || workload === "XL";
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
  const hasLegacyApiOperations = legacy && input.legacyApiOperationCount > 0;
  const apiCoverage = fullDelivery || hasLegacyApiOperations;
  const requirements: ModeRequirementSet = {
    brief: fullDelivery,
    legacyBaseline: legacy,
    legacyInventory: legacy,
    targetedFeatureE2E: feature,
    featureVideo: feature,
    figmaBundle: fullDelivery || figma,
    visualComparison: true,
    apiCoverage,
    performanceEvidence: fullDelivery || legacy,
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
  const requireApiReady = fullDelivery || hasLegacyApiOperations;
  if (requireApiReady) modeValidations.push("api-ready");

  return {
    requirements,
    requireApiReady,
    modeValidations,
    sectionApplicability: {
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
